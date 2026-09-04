# Changelog

## 1.0.0

- First stable release; CLI and `promote()` API are considered stable
- Renamed dry-run short flag from `-n` to `-d`

## 0.0.6

- Add `example/` GitOps fixture for local testing
- Ensure other images in the same `kustomization.yaml` are not touched

## 0.0.5

- Update README

## 0.0.4

- Update CLI commands

## 0.0.3

- Update release workflow

## 0.0.2

- Release preparation

## 0.0.1

- Promote a container image tag from one Kustomize environment overlay to another
- Optional path; looks for the application in the current directory
- CLI (`kkpromote`) and programmatic `promote()` API
