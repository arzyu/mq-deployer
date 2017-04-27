import shell from 'shelljs';

const commands = [
  ['rm', '-rf', './dist'],
  ['mkdir', '-p', './dist'],
  ['exec', './node_modules/.bin/babel --out-dir ./dist ./bin'],
  ['chmod', '755', './dist/mq-deployer.js']
];

commands.forEach((cmd) => {
  const [program, ...args] = cmd;
  shell[program](...args);
});
