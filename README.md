<p align="center">
  <img src="kkpromote.png" alt="kkpromote" width="420">
</p>

# kkpromote

A container image tag promoter for Gitops that works with Kubernetes and Kustomize, promoting an application from one Kustomize environment overlay to another.

[![CI](https://github.com/steveswinsburg/kkpromote/actions/workflows/ci.yml/badge.svg)](https://github.com/steveswinsburg/kkpromote/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/kkpromote.svg)](https://www.npmjs.com/package/kkpromote)
[![license](https://img.shields.io/github/license/steveswinsburg/kkpromote.svg)](LICENSE)

Promotes a container image tag for an application from one Kustomize environment
overlay to another in a GitOps repository.

### Relationship to kustomize

Kustomize's native `kustomize edit set image <name>=<newName>:<newTag>` can
*write* an image tag into a `kustomization.yaml`, but it has no command to
*read* a tag from another overlay and no notion of *promoting* between
environments. 

**kkpromote** performs both the read and the write directly against
the YAML, so it needs no `kustomize` binary installed and preserves comments and
formatting in the edited file.

## How it works

This tool reads the kustomization.yaml from the environment and updates the image tag.

Let's assume your gitops repo is laid out like this:

```
my-app/                     
├── dev/
│   └── kustomization.yaml
├── test/
│   └── kustomization.yaml
└── prod/
    └── kustomization.yaml
```

When you run `kkpromote my-app dev test` from the directory that contains
`my-app/`, it will copy the `newTag` of the `my-app` image from the source
overlay (dev) into the target overlay (test). Path is optional: if omitted, the
current directory is searched for the application.

## Install

Global install:

```bash
npm install -g kkpromote
```

Or run without installing:

```bash
npx kkpromote my-app dev sit
npx kkpromote ~/my-gitops-repo/ my-app dev sit
```

## Usage

```bash
kkpromote [path] <application> <source-env> <target-env> [options]
```

`path` defaults to the current directory. The application is then found as a
subdirectory of that path, or as overlays already in the current directory.

| Option | Description |
| --- | --- |
| `-n, --dry-run` | Show the change without writing the file |
| `-h, --help` | Show help |
| `-v, --version` | Show the version |

Examples:

```bash
kkpromote my-app dev test
# my-app (dev -> test): 1.0.0 -> 1.2.3

kkpromote ~/my-gitops-repo my-app dev sit
# using a path
```

## Programmatic use

```js
import { promote } from 'kkpromote';

const result = promote({
  application: 'my-app',
  sourceEnv: 'dev',
  targetEnv: 'sit',
});
// { changed: true, tag: '1.2.3', previousTag: '1.0.0', ... }

promote({
  path: '/path/to/my-gitops-repo/',
  application: 'my-app',
  sourceEnv: 'dev',
  targetEnv: 'sit',
});
```

## Development

```bash
npm install
npm test
```

`example/` is a small GitOps fixture (not published to npm):

```bash
node bin/cli.js -n example my-app dev test
node bin/cli.js example my-app dev test
```
