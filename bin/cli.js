#!/usr/bin/env node
import { readFileSync } from 'node:fs';

import {
  optionsFromArgs,
  parseSetCliArgs,
  promote,
  PromoteError,
  setImageTag,
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

Set a tag on one overlay (CI deploy) — use kkpromote set --help`;

const SET_USAGE = `kkpromote set - write an image tag to one Kustomize overlay

Usage:
  kkpromote set --target-env <env> --tag <tag> [options]

Required:
  --target-env <env>    environment subdirectory to write the image tag TO
  --tag <tag>           immutable tag to write (e.g. git SHA)

Optional:
  --path <dir>          parent directory containing <application>/ (default: cwd)
  --application, --app  application directory / image name to match
  --image-name <name>   exact images[].name (or newName) to match
  -d, --dry-run         show the change without writing the file
  -h, --help            show this help

Example:
  kkpromote set --path gitops/workloads --application payments-api \\
    --target-env dev --tag abc1234 --image-name ghcr.io/acme/payments-api`;

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
  const argv = process.argv.slice(2);
  if (argv.includes('-v') || argv.includes('--version')) {
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  const command = argv[0];
  if (command === 'set') {
    let setParsed;
    try {
      setParsed = parseSetCliArgs(argv.slice(1));
    } catch (err) {
      if (err instanceof PromoteError) {
        process.stderr.write(`error: ${err.message}\n`);
        process.exit(err.message.includes('required') || err.message.includes('unexpected') ? 2 : 1);
      }
      throw err;
    }
    if (setParsed.help) {
      process.stdout.write(`${SET_USAGE}\n`);
      return;
    }
    try {
      const result = setImageTag({
        path: setParsed.path,
        application: setParsed.application,
        targetEnv: setParsed.targetEnv,
        tag: setParsed.tag,
        imageName: setParsed.imageName,
        dryRun: setParsed.dryRun,
      });
      const prefix = `${result.application} (${result.targetEnv})`;
      if (!result.changed) {
        process.stdout.write(`${prefix} already at ${result.tag}, no change made\n`);
      } else {
        const suffix = setParsed.dryRun ? ' (dry run, not written)' : '';
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

  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    if (err instanceof PromoteError) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }
  const { positionals, options } = parsed;

  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
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
