#!/usr/bin/env node
import { readFileSync } from 'node:fs';

import {
  optionsFromArgs,
  promote,
  PromoteError,
  setImageTag,
  setOptionsFromArgs,
} from '../src/promote.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const USAGE = `kkpromote - promote an application's image tag between Kustomize environments

Usage:
  kkpromote <application> <source-env> <target-env> [options]
  kkpromote <path> <application> <source-env> <target-env> [options]

Arguments:
  path           directory to search for the application (default: current directory)
  application    application name (directory and image name to match)
  source-env     environment subdirectory to copy the image tag FROM
  target-env     environment subdirectory to copy the image tag TO

Options:
  -d, --dry-run       show the change without writing the file
  -h, --help          show this help
  -v, --version       show the version

Examples:
  kkpromote my-app dev test
  kkpromote ~/dev/my-gitops-repo/applications my-app dev sit

Set a tag on one overlay (CI deploy):

  kkpromote set <application> <target-env> <tag> [options]
  kkpromote set <path> <application> <target-env> <tag> [options]

Options (set):
  --image-name <name>   match exact kustomize images[].name or newName`;

const SET_USAGE = `kkpromote set - write an image tag to one Kustomize overlay

Usage:
  kkpromote set <target-env> <tag> [options]
  kkpromote set <application> <target-env> <tag> [options]
  kkpromote set <path> <application> <target-env> <tag> [options]

Arguments:
  path           directory to search for the application (default: current directory)
  application    application name (directory and image name to match)
  target-env     environment subdirectory to write the image tag TO
  tag            immutable tag to write (e.g. git SHA)

Options:
  --image-name <name>   exact images[].name (or newName) to match
  -d, --dry-run         show the change without writing the file
  -h, --help            show this help`;

function parseArgs(argv) {
  const positionals = [];
  const options = { dryRun: false, imageName: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '-v':
      case '--version':
        options.version = true;
        break;
      case '-d':
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--image-name':
        options.imageName = argv[++i] ?? '';
        if (options.imageName === '') {
          throw new PromoteError('--image-name requires a value');
        }
        break;
      default:
        if (arg.startsWith('-')) throw new PromoteError(`unknown option: ${arg}`);
        positionals.push(arg);
    }
  }
  return { positionals, options };
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof PromoteError) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }
  const { positionals, options } = parsed;

  if (options.version) {
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  const command = positionals[0];
  const rest = command === 'set' ? positionals.slice(1) : positionals;

  if (options.help) {
    process.stdout.write(`${command === 'set' ? SET_USAGE : USAGE}\n`);
    return;
  }

  if (command === 'set') {
    const setOpts = setOptionsFromArgs(rest);
    if (!setOpts) {
      process.stderr.write(`${SET_USAGE}\n`);
      process.exit(2);
    }
    try {
      const result = setImageTag({
        ...setOpts,
        imageName: options.imageName || undefined,
        dryRun: options.dryRun,
      });
      const prefix = `${result.application} (${result.targetEnv})`;
      if (!result.changed) {
        process.stdout.write(`${prefix} already at ${result.tag}, no change made\n`);
      } else {
        const suffix = options.dryRun ? ' (dry run, not written)' : '';
        process.stdout.write(`${prefix}: ${result.previousTag} -> ${result.tag}${suffix}\n`);
      }
    } catch (err) {
      if (err instanceof PromoteError) {
        process.stderr.write(`error: ${err.message}\n`);
        process.exit(1);
      }
      throw err;
    }
    return;
  }

  const promoteOpts = optionsFromArgs(positionals);
  if (!promoteOpts) {
    process.stderr.write(`${USAGE}\n`);
    process.exit(2);
  }

  try {
    const result = promote({ ...promoteOpts, dryRun: options.dryRun });
    const prefix = `${result.application} (${promoteOpts.sourceEnv} -> ${promoteOpts.targetEnv})`;
    if (!result.changed) {
      process.stdout.write(`${prefix}: ${promoteOpts.sourceEnv} == ${result.tag}, ${promoteOpts.targetEnv} == ${result.tag} (no change)\n`);
    } else {
      const suffix = options.dryRun ? ' (dry run, not written)' : '';
      process.stdout.write(
        `${prefix}: ${promoteOpts.sourceEnv} == ${result.tag}, ${promoteOpts.targetEnv}: ${result.previousTag} -> ${result.tag}${suffix}\n`
      );
    }
  } catch (err) {
    if (err instanceof PromoteError) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

main();
