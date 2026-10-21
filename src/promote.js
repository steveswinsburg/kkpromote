import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { parseDocument } from 'yaml';

const KUSTOMIZATION_FILE = 'kustomization.yaml';

/** Raised for expected, user-facing errors (missing files, no matching image, etc). */
export class PromoteError extends Error {}

/** Resolve the kustomization.yaml for an application's environment overlay. */
export function kustomizationPath(path, environment) {
  return join(path, environment, KUSTOMIZATION_FILE);
}

export function hasOverlay(dir, environment) {
  return existsSync(kustomizationPath(dir, environment));
}

function isDirectory(path) {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readFileOrThrow(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new PromoteError(`${file} does not exist`);
    }
    throw err;
  }
}

// The kustomization image name is the fully qualified registry path, e.g.
// "registry.example.com/my-app"; match on the trailing image name.
function imageMatches(name, application) {
  return typeof name === 'string' && (name === application || name.endsWith(`/${application}`));
}

function findImage(doc, application, file, imageName) {
  const images = doc.get('images');
  if (images && Array.isArray(images.items)) {
    for (const item of images.items) {
      if (typeof item?.get !== 'function') {
        continue;
      }
      const name = item.get('name');
      const newName = item.get('newName');
      if (imageName) {
        if (name === imageName || newName === imageName) {
          return item;
        }
        continue;
      }
      if (imageMatches(name, application)) {
        return item;
      }
    }
  }
  const label = imageName ?? application;
  throw new PromoteError(`no image entry for '${label}' found in ${file}`);
}

/** Keep the original quoting of a YAML scalar while swapping its value. */
function renderScalar(previous, next) {
  const value = `${next}`;
  if (previous.length >= 2) {
    const quote = previous[0];
    if ((quote === '"' || quote === "'") && previous.endsWith(quote)) {
      return quote === '"' ? JSON.stringify(value) : `'${value.replace(/'/g, "''")}'`;
    }
  }
  return value;
}

/**
 * Replace only the newTag scalar in the original file text, leaving indentation,
 * comments, and the rest of the document unchanged.
 */
function withUpdatedTag(original, image, nextTag, file) {
  const scalar = image.get('newTag', true);
  if (!scalar || !Array.isArray(scalar.range)) {
    throw new PromoteError(`no newTag value to update in ${file}`);
  }
  const [start, valueEnd] = scalar.range;
  const previous = original.slice(start, valueEnd);
  return original.slice(0, start) + renderScalar(previous, nextTag) + original.slice(valueEnd);
}

/**
 * Locate the application overlay directory.
 *
 * `path` defaults to the current working directory. When `application` is set,
 * a subdirectory of that name is preferred; otherwise overlays already in
 * `path` are used (so the command works from inside the app directory).
 *
 * @param {string} [path]
 * @param {string} [application]
 * @param {string} sourceEnv
 * @returns {{path: string, application: string}}
 */
export function resolveAppPath(path, application, sourceEnv) {
  const base = path == null || path === '' ? process.cwd() : path;

  if (application) {
    const nested = join(base, application);
    if (hasOverlay(nested, sourceEnv)) {
      return { path: nested, application };
    }
    if (hasOverlay(base, sourceEnv)) {
      return { path: base, application };
    }
    throw new PromoteError(`could not find application '${application}' in ${base}`);
  }

  if (hasOverlay(base, sourceEnv)) {
    return { path: base, application: basename(resolve(base)) };
  }

  throw new PromoteError(`${kustomizationPath(base, sourceEnv)} does not exist`);
}

/**
 * Interpret CLI positionals as promote options.
 *
 * 2 args: `<source-env> <target-env>` (current directory is the app)
 * 3 args: `<path-or-application> <source-env> <target-env>`
 * 4 args: `<path> <application> <source-env> <target-env>`
 *
 * @param {string[]} positionals
 * @returns {{path?: string, application?: string, sourceEnv: string, targetEnv: string} | null}
 */
export function optionsFromArgs(positionals) {
  if (positionals.length === 2) {
    const [sourceEnv, targetEnv] = positionals;
    return { sourceEnv, targetEnv };
  }
  if (positionals.length === 3) {
    const [first, sourceEnv, targetEnv] = positionals;
    if (isDirectory(first)) {
      return { path: first, sourceEnv, targetEnv };
    }
    return { application: first, sourceEnv, targetEnv };
  }
  if (positionals.length === 4) {
    const [path, application, sourceEnv, targetEnv] = positionals;
    return { path, application, sourceEnv, targetEnv };
  }
  return null;
}

/**
 * Copy an application's image tag from a source environment overlay into a target one.
 *
 * @param {object} options
 * @param {string} [options.path] directory to search; defaults to the current working
 *   directory. May be the application overlay directory itself, or a parent that
 *   contains `<application>/`
 * @param {string} [options.application] image/directory name to match; defaults to
 *   the basename of the resolved application directory
 * @param {string} options.sourceEnv environment subdirectory to copy the tag from
 * @param {string} options.targetEnv environment subdirectory to copy the tag into
 * @param {boolean} [options.dryRun] when true, compute the change without writing
 * @returns {{changed: boolean, application: string, sourceEnv: string, targetEnv: string,
 *   tag: string, previousTag: string, targetFile: string}}
 */
export function promote({ path, application: applicationName, sourceEnv, targetEnv, dryRun = false }) {
  if (sourceEnv === targetEnv) {
    throw new PromoteError('source and target environment must be different');
  }

  const resolved = resolveAppPath(path, applicationName, sourceEnv);
  const application = resolved.application;
  const sourceFile = kustomizationPath(resolved.path, sourceEnv);
  const targetFile = kustomizationPath(resolved.path, targetEnv);

  const sourceDoc = parseDocument(readFileOrThrow(sourceFile));
  const sourceTag = findImage(sourceDoc, application, sourceFile).get('newTag');
  if (sourceTag == null || `${sourceTag}`.trim() === '') {
    throw new PromoteError(`no newTag set for '${application}' in ${sourceFile}`);
  }

  const targetRaw = readFileOrThrow(targetFile);
  const targetDoc = parseDocument(targetRaw);
  const targetImage = findImage(targetDoc, application, targetFile);
  const previousTag = targetImage.get('newTag');

  const result = { changed: false, application, sourceEnv, targetEnv, tag: sourceTag, previousTag, targetFile };
  if (previousTag === sourceTag) {
    return result;
  }

  if (!dryRun) {
    writeFileSync(targetFile, withUpdatedTag(targetRaw, targetImage, sourceTag, targetFile));
  }
  result.changed = true;
  return result;
}

/**
 * Set an application's image tag on a single environment overlay (CI deploy path).
 *
 * @param {object} options
 * @param {string} [options.path] parent directory or application overlay directory
 * @param {string} [options.application] application / image name to match
 * @param {string} options.targetEnv environment subdirectory to update (same name as promote)
 * @param {string} options.tag immutable tag to write (e.g. git SHA)
 * @param {string} [options.imageName] exact kustomize images[].name (or newName) to match
 * @param {boolean} [options.dryRun] when true, compute the change without writing
 * @returns {{changed: boolean, application: string, targetEnv: string, tag: string,
 *   previousTag: string, targetFile: string}}
 */
export function setImageTag({
  path,
  application: applicationName,
  targetEnv,
  tag,
  imageName,
  dryRun = false,
}) {
  if (tag == null || `${tag}`.trim() === '') {
    throw new PromoteError('tag is required');
  }

  const resolved = resolveAppPath(path, applicationName, targetEnv);
  const application = resolved.application;
  const targetFile = kustomizationPath(resolved.path, targetEnv);

  const targetRaw = readFileOrThrow(targetFile);
  const targetDoc = parseDocument(targetRaw);
  const targetImage = findImage(targetDoc, application, targetFile, imageName);
  const previousTag = targetImage.get('newTag');

  const result = {
    changed: false,
    application,
    targetEnv,
    tag,
    previousTag,
    targetFile,
  };
  if (`${previousTag}` === `${tag}`) {
    return result;
  }

  if (!dryRun) {
    writeFileSync(targetFile, withUpdatedTag(targetRaw, targetImage, tag, targetFile));
  }
  result.changed = true;
  return result;
}

/**
 * CLI positionals for `kkpromote set` (mirrors {@link optionsFromArgs} shape).
 *
 * 2 args: `<target-env> <tag>` (current directory is the app)
 * 3 args: `<path-or-application> <target-env> <tag>`
 * 4 args: `<path> <application> <target-env> <tag>`
 *
 * @param {string[]} positionals
 * @returns {{path?: string, application?: string, targetEnv: string, tag: string} | null}
 */
export function setOptionsFromArgs(positionals) {
  if (positionals.length === 2) {
    const [targetEnv, tag] = positionals;
    return { targetEnv, tag };
  }
  if (positionals.length === 3) {
    const [first, targetEnv, tag] = positionals;
    if (isDirectory(first)) {
      return { path: first, targetEnv, tag };
    }
    return { application: first, targetEnv, tag };
  }
  if (positionals.length === 4) {
    const [path, application, targetEnv, tag] = positionals;
    return { path, application, targetEnv, tag };
  }
  return null;
}
