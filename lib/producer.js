import program from 'commander';
import amqp from 'amqplib';

import { version } from '../package';

const sendMessage = (amqpURI, exchange, router, messageText) => {
	amqp.connect(amqpURI)
		.then((connection) => {
			connection
				.createConfirmChannel()
				.then((channel) => {
					let rpcReplyQueue;
					(async function () {
						await channel.assertExchange(exchange, 'topic', { durable: true });
						rpcReplyQueue = await channel.assertQueue('', { exclusive: true });
					})().then(() => {
						// 等待远程调用返回
						const correlationId = `${Date.now()}${Math.random()}`;
						channel.consume(rpcReplyQueue.queue, (message) => {
							console.log(message.content.toString());
							if (message.properties.correlationId === correlationId) {
								console.log('\n[producer]: Deploying finished.')
								connection.close();
							}
						}, { noAck: true });

						// 发布远程部署消息
						channel.publish(exchange, router, new Buffer(messageText),
								{
									correlationId,
									replyTo: rpcReplyQueue.queue
								},
								(err, ok) => {
									if (err) {
										console.warn('\n[producer]: Deploying message uacked.');
									} else {
										console.log('\n[producer]: Deploying message acked.');
									}
								});
					})
					.catch(console.error);
				})
				.catch(console.error);
		})
		.catch(console.error);
};

program
	.version(version)
	.option('--uri <uri>', 'An amqp URI')
	.option('-x, --exchange <exchange>', 'An amqp exchange')
	.option('--router <router>', 'An amqp router')
	.option('-m, --message <text>', 'A message to send')
	.parse(process.argv);

sendMessage(program.uri, program.exchange, program.router, program.message);

