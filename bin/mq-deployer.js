#!/usr/bin/env node
import program from 'commander';

import { version } from '../package';

program
  .version(version)
  .command('start <config.yml>', 'start a consumer service from YAML config file')
  .command('send <message>', 'produce a AMQP message of JSON string')
  .parse(process.argv);
