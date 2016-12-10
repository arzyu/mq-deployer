import fs from 'fs';
import assert from 'assert';

import program from 'commander';
import getStdin from 'get-stdin';
import amqp from 'amqplib';
import uuid from 'node-uuid';

program
  .option('-c, --config <file>', 'Specify JSON config file')
  .option('--uri <uri>', 'AMQP URI')
  .option('-x, --exchange <exchange>', 'AMQP exchange')
  .option('--router <router>', 'AMQP router')
  .option('-m, --message <text>', 'Message for sending')
  .parse(process.argv);

(async function () {
  const options = {};

  // 从配置文件中加载设置
  if (program.config) {
    Object.assign(options, JSON.parse(fs.readFileSync(program.config, { encoding: 'utf8' })));
  }

  // 从标准输入加载设置
  Object.assign(options, JSON.parse((await getStdin()).trim() || '{}'));

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

  if (program.message) {
    options.message = program.message;
  }
  assert.strictEqual(!!options.message, true);

  console.log(options);

  const connection = await amqp.connect(options.uri);
  const channel = await connection.createConfirmChannel();

  /* 等待 RPC 完成 */

  const rpcReplyQueue = await channel.assertQueue('', { exclusive: true });
  const correlationId = uuid.v4();
  const consumers = new Set();

  console.log(`\n[producer]:[q: ${rpcReplyQueue.queue}]: Waiting for consumers' acks.`);

  channel.consume(rpcReplyQueue.queue, (message) => {
    new Promise((resolve, reject) => {
      const deployInfo = JSON.parse(message.content.toString());

      // 只处理本次 RPC 的返回消息
      if (message.properties.correlationId === correlationId) {
        console.log(`\n[producer] ${deployInfo.message}`);
        const consumerQueue = deployInfo.queue;
        switch (deployInfo.state) {
        case 'ACK':
          consumers.add(consumerQueue);
          break;
        case 'REFUSED':
        case 'DONE':
          consumers.delete(consumerQueue);
          if (!consumers.size) {
            const timeout = 10000;
            console.log(`\n[producer]: Waiting another ${timeout/1000}s and seeing if there is no other acks.`);
            setTimeout(() => {
              if (!consumers.size) {
                resolve();
              }
            }, timeout);
          }
          break;
        case 'ACCEPTED':
          console.log(`\n[producer]: Waiting for [consumer][q: ${consumerQueue}].`);
          break;
        default:
        }
      }
    }).then(() => {
      console.log('\n[producer]: All comsumers done.');
      connection.close();
    }).catch((error) => {
      console.log(error);
      connection.close();
      process.exit(1);
    });
  }, { noAck: true });

  /* 发布 RPC 消息 */

  const exchange = options.exchange;
  await channel.assertExchange(exchange, 'topic', { durable: true });
  await channel.publish(exchange, options.router, new Buffer(options.message),
      {
        correlationId,
        replyTo: rpcReplyQueue.queue
      },
      (err, ok) => {
        if (err) {
          console.error('\n[producer]: Deploying message uacked.');
          connection.close();
          process.exit(1);
        }
        console.log('\n[producer]: Deploying message acked.');
      }
  );

}()).catch(console.error);

