#!/usr/bin/env node
import assert from 'assert';

import program from 'commander';
import amqp from 'amqplib';
import uuid from 'uuid';

import { version } from '../package';

program
  .version(version)
  .option('--uri <uri>', 'AMQP URI')
  .option('-x, --exchange <exchange>', 'AMQP exchange')
  .option('-r, --router <router>', 'AMQP router')
  .parse(process.argv);

// TODO: other asserts
assert.strictEqual(program.args.length, 1, 'missing [message] content');

const [messageText] = program.args;

assert.doesNotThrow(() => {
  JSON.parse(messageText);
}, SyntaxError, `invalid JSON: ${messageText}`);

async function send(message, config) {
  const { uri, exchange, router } = config;
  const connection = await amqp.connect(uri);
  const channel = await connection.createChannel();

  // 创建一个匿名队列用于接收反馈
  const rpcReplyQueue = await channel.assertQueue('', { exclusive: true });
  const correlationId = uuid.v4();
  const consumers = new Set();

  // 等待 consumers 的计时器
  let consumerTimer;

  const processReply = reply => new Promise((resolve, reject) => {
    const response = JSON.parse(reply.content.toString());

    if (reply.properties.correlationId !== correlationId) {
      return;
    }

    const worker = response.queue;

    console.log(`\n[${worker}]:\n ${response.message}`);

    switch (response.state) {
    case 'ACK':
      consumers.add(worker);
      setTimeout(() => reject(new Error('Timeout.')), 600000);
      break;
    case 'DONE':
      consumers.delete(worker);
      if (!consumers.size) {
        if (!consumerTimer) {
          process.stdout.write('\n[producer]: Waiting for 10s ...');
          consumerTimer = setTimeout(
            () => {
              if (!consumers.size) {
                process.stdout.write(' done!\n');
                resolve();
              }
            },
            10000
          );
        }
      }
      break;
    case 'ERROR':
      reject(new Error('Task error.'));
      break;
    default:
    }
  });

  channel.consume(
    rpcReplyQueue.queue,
    (reply) => {
      processReply(reply)
        .then(() => {
          console.log('[producer]: Deployment successful.');
          connection.close();
          process.exit(0);
        })
        .catch((error) => {
          console.log(`\n[producer]: ${error.message}`);
          console.log('[producer]: Deployment failed.');
          connection.close();
          process.exit(1);
        });
    },
    { noAck: true }
  );

  await channel.assertExchange(exchange, 'topic', { durable: false, autoDelete: true });

  await channel.publish(
    exchange,
    router,
    new Buffer(message),
    {
      correlationId,
      replyTo: rpcReplyQueue.queue
    }
  );

  setTimeout(() => {
    console.log('[producer]: No running consumer. Exit.');
    connection.close();
    process.exit(1);
  }, 20000);
}

send(messageText, {
  uri: program.uri,
  exchange: program.exchange,
  router: program.router
});
