import path from 'path';
import zlib from 'zlib';
import assert from 'assert';

import program from 'commander';
import yaml from 'js-yaml';
import amqp from 'amqplib';
import address from 'address';
import uuid from 'uuid';
import request from 'request';
import tar from 'tar';
import fs from 'fs-extra';

import { version } from '../package';

program
  .version(version)
  .parse(process.argv);

// TODO: other asserts
assert.strictEqual(program.args.length, 1, 'missing YAML config file');

const yamlConfig = yaml.safeLoad(fs.readFileSync(program.args[0], 'utf8'));

// 获取 consumer 的 IP, MAC 信息
const getAddressInfo = () => new Promise((resolve, reject) => {
  address((err, addressInfo) => {
    if (err) {
      reject(err);
      return;
    }
    resolve(addressInfo);
  });
});

const deploy = pack => new Promise((resolve, reject) => {
  const extractPath = path.resolve(pack.destination, uuid.v4());

  const customReject = (error) => {
    console.log(error);
    fs.removeSync(extractPath);
    reject(error);
  };

  process.on('exit', () => customReject('exit'));
  process.on('SIGINT', () => customReject('SIGINT'));

  fs.ensureDirSync(extractPath);

  request.get(pack.url, (error) => {
    if (error) {
      customReject(error);
    }
  })
    .pipe(
      zlib.createGunzip()
        .on('error', (error) => {
          customReject(error);
        })
    )
    .pipe(
      tar.Extract({ path: extractPath, strip: 1}) // eslint-disable-line
        .on('error', (error) => {
          customReject(error);
        })
    )
    .on('finish', () => {
      fs.moveSync(
        extractPath,
        path.resolve(pack.destination, pack.name),
        { overwrite: true }
      );
      resolve();
    })
    .on('error', (error) => {
      customReject(error);
    });
});

async function start(config) {
  const { uri, exchange, tasks } = config;
  const connection = await amqp.connect(uri);
  const channel = await connection.createChannel();
  const addressInfo = await getAddressInfo();

  async function replyToQueue(queue, correlationId, response) {
    await channel.sendToQueue(
      queue,
      new Buffer(JSON.stringify(response)),
      { correlationId }
    );
  }

  await channel.assertExchange(exchange, 'topic', { durable: false, autoDelete: true });

  channel.on('error', (error) => {
    console.log(error.stack);
    process.exit(1);
  });

  process.on('SIGINT', () => connection.close());

  tasks.forEach(async (task) => {
    const queue = `${exchange}>${task.router}<>${addressInfo.ip}:${uuid.v4()}`;

    console.log(`\n[${queue}]:\n Queue created.`);

    await channel.assertQueue(queue, { durable: false, autoDelete: true });
    await channel.bindQueue(queue, exchange, task.router);

    channel.consume(queue, (message) => {
      const packageInfo = JSON.parse(message.content.toString());
      const { correlationId, replyTo } = message.properties;

      console.log(`\n[${queue}]:\n ${JSON.stringify(packageInfo)}`);

      const deployInfo = {
        name: task.name,
        destination: task.destination,
        url: packageInfo.packageUrl
      };

      // 接收到消息后立即反馈
      replyToQueue(replyTo, correlationId, {
        queue, state: 'ACK', message: JSON.stringify(deployInfo)
      });

      deploy(deployInfo).then(() => {
        console.log(`\n[${queue}]:\n Task done.`);
        replyToQueue(replyTo, correlationId, {
          queue, state: 'DONE', message: 'Task done.'
        });
      }).catch((error) => {
        console.log(`\n[${queue}]:\n Task failed.`);
        replyToQueue(replyTo, correlationId, {
          queue, state: 'ERROR', message: `${error.message}\n${error.stack}`
        });
      });
    }, { noAck: true });
  });
}

process.on('unhandledRejection', (error) => {
  console.log(error.stack);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.log(error.stack);
  process.exit(1);
});

start(yamlConfig);
