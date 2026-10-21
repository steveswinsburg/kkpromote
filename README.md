<p align="center">
  <img src="kkpromote.png" alt="kkpromote" width="420">
</p>

# kkpromote

Promotes a container image tag for an application from one Kustomize environment
overlay to another in a GitOps repository.

[![CI](https://github.com/steveswinsburg/kkpromote/actions/workflows/ci.yml/badge.svg)](https://github.com/steveswinsburg/kkpromote/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/kkpromote.svg)](https://www.npmjs.com/package/kkpromote)
[![license](https://img.shields.io/github/license/steveswinsburg/kkpromote.svg)](LICENSE)

### Relationship to kustomize

Kustomize's native `kustomize edit set image <name>=<newName>:<newTag>` can
*write* an image tag into a `kustomization.yaml`, but it has no command to
*read* a tag from another overlay and no notion of *promoting* between
environments. 

**kkpromote** performs both the read and the write directly against
the YAML, so it needs no `kustomize` binary installed and preserves comments and
formatting in the edited file.

## How it works

**kkpromote** reads the kustomization.yaml from the source environment and updates the image tag into the target environment.

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

When you run `kkpromote my-app dev test` it will copy the `newTag` of the `my-app` image from the source
overlay (dev) into the target overlay (test). 

Path is optional: if omitted, the current directory is searched for the application to promote.

## Install

Global install:

```bash
npm install -g kkpromote
```

Or run without installing via `npx`:

```bash
npx kkpromote my-app dev sit
npx kkpromote ~/my-gitops-repo/ my-app dev sit
```

## Usage

```bash
kkpromote [path] <application> <source-env> <target-env> [options]
```

`path` defaults to the current directory. The application is then found as a subdirectory of that path, or as overlays already in the current directory.

| Option | Description |
| --- | --- |
| `-d, --dry-run` | Simulate the change without changing anything |
| `-h, --help` | View help |
| `-v, --version` | Check the version |

Examples:

```bash
kkpromote my-app dev test
# my-app (dev -> test): 1.0.0 -> 1.2.3

kkpromote ~/my-gitops-repo my-app dev sit
# using a path
```

### Set a tag on one overlay (CI deploy)

`promote` copies a tag **from** one overlay **to** another. Continuous deploy (build → gitops) needs to
**write a new tag** (usually a git SHA) onto a single overlay without a source environment.

```bash
kkpromote set --target-env dev --tag abc1234

kkpromote set --path gitops/workloads --application payments-api \
  --target-env dev --tag abc1234 \
  --image-name ghcr.io/acme/payments-api
```

`set` uses **named flags** (same fields as the `setImageTag()` API). `promote` keeps positional args for quick env-to-env copies.

| Option | Description |
| --- | --- |
| `--image-name` | Match exact `images[].name` or `newName` (default: match on application directory name) |
| `-d, --dry-run` | Simulate the change without writing |

The overlay must already define `images[].newTag` for the target image (same requirement as promote).

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

```js
import { setImageTag } from 'kkpromote';

setImageTag({
  path: 'gitops/workloads',
  application: 'payments-api',
  targetEnv: 'dev',
  tag: 'abc1234',
  imageName: 'ghcr.io/acme/payments-api',
});
```

## Development

```bash
npm install
npm test
npm link
```

The `example/` directory has a small GitOps layout you can use to test:

```bash
kkpromote --dry-run example my-app dev test
kkpromote example my-app dev test
```

---

Made with ❤️ for GitOps nerds.
