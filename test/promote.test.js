import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { promote, PromoteError, kustomizationPath, optionsFromArgs } from '../src/promote.js';

const REGISTRY = 'registry.example.com';

function kustomization(application, tag) {
  return `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
- ../base

images:
- name: ${REGISTRY}/${application}
  newName: ${REGISTRY}/${application}
  newTag: ${tag} # pinned by CI
`;
}

function makeApplication({ application = 'my-app', envs }) {
  const repo = mkdtempSync(join(tmpdir(), 'kip-'));
  const path = join(repo, 'applications', application);
  for (const [env, tag] of Object.entries(envs)) {
    const dir = join(path, env);
    mkdirSync(dir, { recursive: true });
    writeFileSync(kustomizationPath(path, env), kustomization(application, tag));
  }
  return path;
}

function tagIn(path, env) {
  const raw = readFileSync(kustomizationPath(path, env), 'utf8');
  return raw.match(/newTag:\s*(\S+)/)[1];
}

// path is `<tmp-root>/applications/<application>`; remove the whole tmp root.
function cleanup(path) {
  rmSync(dirname(dirname(path)), { recursive: true, force: true });
}

function withCwd(dir, fn) {
  const previous = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(previous);
  }
}

test('promotes the source tag into the target overlay', () => {
  const path = makeApplication({ envs: { dev: '1.2.3', sit: '1.0.0' } });
  try {
    const result = promote({ path, sourceEnv: 'dev', targetEnv: 'sit' });
    assert.equal(result.changed, true);
    assert.equal(result.application, 'my-app');
    assert.equal(result.previousTag, '1.0.0');
    assert.equal(result.tag, '1.2.3');
    assert.equal(tagIn(path, 'sit'), '1.2.3');
  } finally {
    cleanup(path);
  }
});

test('preserves comments when writing', () => {
  const path = makeApplication({ envs: { dev: '1.2.3', sit: '1.0.0' } });
  try {
    promote({ path, sourceEnv: 'dev', targetEnv: 'sit' });
    const raw = readFileSync(kustomizationPath(path, 'sit'), 'utf8');
    assert.match(raw, /# pinned by CI/);
  } finally {
    cleanup(path);
  }
});

test('rewrites only the newTag value, keeping indent and the rest of the file', () => {
  const repo = mkdtempSync(join(tmpdir(), 'kip-'));
  const path = join(repo, 'applications', 'my-app');
  const original = (tag) => `kind: Kustomization
resources:
    - ../base
images:
    - name: ${REGISTRY}/my-app
      newName: ${REGISTRY}/my-app
      newTag: ${tag} # pinned by CI
`;
  try {
    for (const [env, tag] of [['dev', '1.2.3'], ['sit', '1.0.0']]) {
      mkdirSync(join(path, env), { recursive: true });
      writeFileSync(kustomizationPath(path, env), original(tag));
    }
    promote({ path, sourceEnv: 'dev', targetEnv: 'sit' });
    const raw = readFileSync(kustomizationPath(path, 'sit'), 'utf8');
    assert.equal(raw, original('1.2.3'));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('preserves quoting around newTag', () => {
  const repo = mkdtempSync(join(tmpdir(), 'kip-'));
  const path = join(repo, 'applications', 'my-app');
  try {
    for (const [env, tag] of [['dev', '1.2.3'], ['sit', '1.0.0']]) {
      mkdirSync(join(path, env), { recursive: true });
      writeFileSync(
        kustomizationPath(path, env),
        `kind: Kustomization
images:
- name: ${REGISTRY}/my-app
  newTag: "${tag}"
`,
      );
    }
    promote({ path, sourceEnv: 'dev', targetEnv: 'sit' });
    const raw = readFileSync(kustomizationPath(path, 'sit'), 'utf8');
    assert.match(raw, /newTag: "1\.2\.3"/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('is a no-op when the tags already match', () => {
  const path = makeApplication({ envs: { dev: '1.2.3', sit: '1.2.3' } });
  try {
    const result = promote({ path, sourceEnv: 'dev', targetEnv: 'sit' });
    assert.equal(result.changed, false);
  } finally {
    cleanup(path);
  }
});

test('dry-run does not write the file', () => {
  const path = makeApplication({ envs: { dev: '1.2.3', sit: '1.0.0' } });
  try {
    const result = promote({ path, sourceEnv: 'dev', targetEnv: 'sit', dryRun: true });
    assert.equal(result.changed, true);
    assert.equal(tagIn(path, 'sit'), '1.0.0');
  } finally {
    cleanup(path);
  }
});

test('rejects identical source and target environments', () => {
  const path = makeApplication({ envs: { dev: '1.2.3' } });
  try {
    assert.throws(
      () => promote({ path, sourceEnv: 'dev', targetEnv: 'dev' }),
      PromoteError,
    );
  } finally {
    cleanup(path);
  }
});

test('errors when an overlay is missing', () => {
  const path = makeApplication({ envs: { dev: '1.2.3' } });
  try {
    assert.throws(
      () => promote({ path, sourceEnv: 'dev', targetEnv: 'sit' }),
      /sit[/\\]kustomization\.yaml does not exist/,
    );
  } finally {
    cleanup(path);
  }
});

test('errors when no image entry matches the application', () => {
  const repo = mkdtempSync(join(tmpdir(), 'kip-'));
  const path = join(repo, 'applications', 'mystery');
  try {
    for (const env of ['dev', 'sit']) {
      const dir = join(path, env);
      mkdirSync(dir, { recursive: true });
      // overlay exists but its image is for a different application
      writeFileSync(kustomizationPath(path, env), kustomization('other-app', '1.0.0'));
    }
    assert.throws(
      () => promote({ path, sourceEnv: 'dev', targetEnv: 'sit' }),
      /no image entry for 'mystery'/,
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('finds the application in the current directory when path is omitted', () => {
  const path = makeApplication({ envs: { dev: '1.2.3', sit: '1.0.0' } });
  try {
    const result = withCwd(dirname(path), () =>
      promote({ application: 'my-app', sourceEnv: 'dev', targetEnv: 'sit' }),
    );
    assert.equal(result.changed, true);
    assert.equal(result.application, 'my-app');
    assert.equal(tagIn(path, 'sit'), '1.2.3');
  } finally {
    cleanup(path);
  }
});

test('finds overlays in the current directory when it is the application', () => {
  const path = makeApplication({ envs: { dev: '1.2.3', sit: '1.0.0' } });
  try {
    const result = withCwd(path, () =>
      promote({ application: 'my-app', sourceEnv: 'dev', targetEnv: 'sit' }),
    );
    assert.equal(result.changed, true);
    assert.equal(tagIn(path, 'sit'), '1.2.3');
  } finally {
    cleanup(path);
  }
});

test('infers the application from the current directory when only envs are given', () => {
  const path = makeApplication({ envs: { dev: '1.2.3', sit: '1.0.0' } });
  try {
    const result = withCwd(path, () =>
      promote({ sourceEnv: 'dev', targetEnv: 'sit' }),
    );
    assert.equal(result.changed, true);
    assert.equal(result.application, 'my-app');
    assert.equal(tagIn(path, 'sit'), '1.2.3');
  } finally {
    cleanup(path);
  }
});

test('finds the application under an explicit parent path', () => {
  const path = makeApplication({ envs: { dev: '1.2.3', sit: '1.0.0' } });
  try {
    const result = promote({
      path: dirname(path),
      application: 'my-app',
      sourceEnv: 'dev',
      targetEnv: 'sit',
    });
    assert.equal(result.changed, true);
    assert.equal(tagIn(path, 'sit'), '1.2.3');
  } finally {
    cleanup(path);
  }
});

test('errors when the application cannot be found in the current directory', () => {
  const path = makeApplication({ envs: { dev: '1.2.3', sit: '1.0.0' } });
  try {
    withCwd(dirname(path), () => {
      assert.throws(
        () => promote({ application: 'missing-app', sourceEnv: 'dev', targetEnv: 'sit' }),
        /could not find application 'missing-app'/,
      );
    });
  } finally {
    cleanup(path);
  }
});

test('optionsFromArgs treats two args as envs in the current directory', () => {
  assert.deepEqual(optionsFromArgs(['dev', 'test']), {
    sourceEnv: 'dev',
    targetEnv: 'test',
  });
});

test('optionsFromArgs treats a non-directory first arg as the application name', () => {
  assert.deepEqual(optionsFromArgs(['my-app', 'dev', 'test']), {
    application: 'my-app',
    sourceEnv: 'dev',
    targetEnv: 'test',
  });
});

test('optionsFromArgs treats a directory first arg as the path', () => {
  const path = makeApplication({ envs: { dev: '1.2.3', sit: '1.0.0' } });
  try {
    assert.deepEqual(optionsFromArgs([path, 'dev', 'sit']), {
      path,
      sourceEnv: 'dev',
      targetEnv: 'sit',
    });
  } finally {
    cleanup(path);
  }
});

test('optionsFromArgs accepts an explicit path and application', () => {
  assert.deepEqual(optionsFromArgs(['/gitops/applications', 'my-app', 'dev', 'test']), {
    path: '/gitops/applications',
    application: 'my-app',
    sourceEnv: 'dev',
    targetEnv: 'test',
  });
});

test('optionsFromArgs rejects the wrong number of arguments', () => {
  assert.equal(optionsFromArgs(['dev']), null);
  assert.equal(optionsFromArgs(['a', 'b', 'c', 'd', 'e']), null);
});
