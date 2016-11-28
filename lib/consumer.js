import { execSync } from 'child_process';

import program from 'commander';
import amqp from 'amqplib';

import { version } from '../package';

const receiveMessage = (amqpURI, exchange, router, directory) => {
	amqp.connect(amqpURI)
		.then((connection) => {
			connection
				.createChannel()
				.then((channel) => {
					const queue = 'deploy_tasks';
					(async function () {
						await channel.assertExchange(exchange, 'topic', { durable: true });
						await channel.assertQueue(queue);
						await channel.bindQueue(queue, exchange, router);
					})().then(() => {
						channel.consume(queue, (message) => {
							const projectInfo = JSON.parse(message.content.toString());
							const cmd = `curl -L ${projectInfo.packageUrl} | tar xzv`
							console.log(`\n[consumer]: ${projectInfo}`);
							execSync(cmd, { cwd: directory, stdio: 'inherit' });
							channel.sendToQueue(
								message.properties.replyTo,
								new Buffer('\n[consumer]: Task end.'),
								{ correlationId: message.properties.correlationId }
							);
							channel.ack(message);
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
	.option('--directory <directory>', 'Directory to deploy')
	.parse(process.argv);

receiveMessage(program.uri, program.exchange, program.router, program.directory);

