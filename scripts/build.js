import shell from 'shelljs';

const src = './bin';
const dest = './dist';

function generateBuildCmds() {
  const buildCmds = [];
  shell.ls(src).forEach((file) => {
    buildCmds.push(
      ['exec', `./node_modules/.bin/babel ${src}/${file} -o ${dest}/${file}`],
      ['chmod', '755', `${dest}/${file}`]
    );
  });
  return buildCmds;
}

const commands = [
  ['rm', '-rf', dest],
  ['mkdir', '-p', dest],
  ...generateBuildCmds()
];

commands.forEach((cmd) => {
  const [program, ...args] = cmd;
  shell[program](...args);
});
