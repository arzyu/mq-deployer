import { execSync } from 'child_process';

import program from 'commander';
import amqp from 'amqplib';

import { version } from '../package';

const receiveMessage = (amqpURI, exchange, directory) => {
	amqp.connect(amqpURI)
		.then((connection) => {
			connection
				.createChannel()
				.then((channel) => {
					const queue = 'deploy_tasks';
					(async function () {
						await channel.assertExchange(exchange, 'topic', { durable: true });
						await channel.assertQueue(queue);
						await channel.bindQueue(queue, exchange, 'ccms.*.dev');
					})().then(() => {
						channel.consume(queue, (message) => {
							const projectInfo = JSON.parse(message.content.toString());
							const cmd = `curl -L ${projectInfo.packageUrl} | tar xzv`
							execSync(cmd, { cwd: directory, stdio: 'inherit' });
							setTimeout(() => {
								channel.sendToQueue(
									message.properties.replyTo,
									new Buffer('任务完成'),
									{ correlationId: message.properties.correlationId }
								);
								channel.ack(message);
							}, 5000)
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
	.option('--directory <directory>', 'Directory to deploy')
	.parse(process.argv);

receiveMessage(program.uri, program.exchange, program.directory);

