import fs from 'fs';
import assert from 'assert';
import { execSync } from 'child_process';

import program from 'commander';
import getStdin from 'get-stdin';
import amqp from 'amqplib';
import uuid from 'node-uuid';
import address from 'address';

import { version } from '../package';

program
  .version(version)
  .option('-c, --config <file>', 'Specify JSON config file')
  .option('-d, --destination <directory>', 'Destination directory to deploy')
  .option('--uri <uri>', 'AMQP URI')
  .option('-x, --exchange <exchange>', 'AMQP exchange')
  .option('--router <router>', 'AMQP router')
  .parse(process.argv);

// 获取 consumer 的 IP, MAC 信息
const getAddressInfo = () => (
	new Promise((resolve, reject) => {
		address((err, addressInfo) => {
			if (err) {
				reject(err);
				return;
			}
			resolve(addressInfo);
		});
	})
);

// 执行部署脚本
const deployPackage = async function (context, packageInfo) {
  const routingKey = context.message.fields.routingKey;
  const destination = context.options.destination;
  const deployName = routingKey.split('.')[1];
  const tmpDeployName = uuid.v4();
  const cmds = [
    `mkdir -p ${deployName} ${tmpDeployName}`,
    `curl -L ${packageInfo.packageUrl} | tar -xzvC ${tmpDeployName} --strip-components 1`,
    `rm -rf ${deployName}`,
    `mv ${tmpDeployName} ${deployName}`
  ];
  const options = { cwd: `${destination}`, stdio: 'inherit' };
  execSync(`mkdir -p ${destination}`, { stdio: 'inherit' });
  cmds.forEach((cmd) => {
    execSync(cmd, options);
  });
};

(async function () {
  const options = {};

  // 从配置文件中加载设置
  if (program.config) {
    Object.assign(options, JSON.parse(fs.readFileSync(program.config, { encoding: 'utf8' })));
  }

  // 从标准输入加载设置
  Object.assign(options, JSON.parse((await getStdin()).trim() || '{}'));

  if (program.destination) {
    options.destination = program.destination;
  }
  assert.strictEqual(!!options.destination, true);

  if (program.uri) {
    options.uri = program.uri;
  }
  assert.strictEqual(!!options.uri, true);

  if (program.exchange) {
    options.exchange = program.exchange;
  }
  assert.strictEqual(!!options.exchange, true);

  if (program.router) {
    options.router = program.router;
  }
  assert.strictEqual(!!options.router, true);

  console.log(options);

  const connection = await amqp.connect(options.uri);
  const channel = await connection.createChannel();
  const exchange = options.exchange;
  const router = options.router;

	const addressInfo = await getAddressInfo();
  const taskQueue = `${exchange}>${router}<>${addressInfo.ip}/${addressInfo.mac}${Math.random()}`;

  await channel.assertExchange(exchange, 'topic', { durable: true });
  await channel.assertQueue(taskQueue, { exclusive: true, durable: true });
  await channel.bindQueue(taskQueue, exchange, router);

  channel.consume(taskQueue, (message) => {
    // 给 RPC client 回复消息
    const reply = async function (response) {
			response.message = `<- [consumer][q: ${taskQueue}]: ${response.message}`;
			response.queue = taskQueue;
      await channel.sendToQueue(
        message.properties.replyTo,
        new Buffer(JSON.stringify(response)),
        { correlationId: message.properties.correlationId }
      );
    };

    const messageText = message.content.toString();

    (async function () {
      const packageInfo = JSON.parse(messageText);

      console.log(`[consumer]: ${JSON.stringify(packageInfo)}\n`);

			// 接收到消息后，立即向 RPC client 报到
			await reply({ state: 'ACK', message: 'Acked.' });

			// 执行部署任务
      await deployPackage({ options, message }, packageInfo);

			// 通知 RPC client 任务完成
      await reply({ state: 'DONE', message: 'Task done.' });

      channel.ack(message);

    }()).catch((e) => {
      if (e.name === 'SyntaxError' && e.message.includes('JSON')) {

        (async function () {
          // 接收到非 JSON 消息时拒绝处理并丢弃消息
          await reply({
            state: 'REFUSED',
            message: `Invalid JSON message, dropped:\n'${messageText}'`
          });

          channel.ack(message);
        }()).catch(console.error);

      } else {

        (async function () {
          // 执行任务出错后向 RPC client 反馈信息
          await reply({
            state: 'ACCEPTED',
            message: `Consumer error:\n${e.stack}`
          });
        }()).catch(console.error);

      }
    });

  });

}()).catch(console.error);

