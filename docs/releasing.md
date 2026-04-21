# Releasing

This document explains how the `acai` CLI release pipeline works for npm and GitHub Releases, and what a maintainer needs to do to cut a release.

## Overview

Releases are tag-driven.

When a tag matching `v*` is pushed, GitHub Actions runs `.github/workflows/release.yml` and does four things:

1. Verifies the tag version matches `package.json`
2. Runs the test suite
3. Packs and installs the npm artifact, then runs smoke checks against that installed package under a real Node runtime
4. Publishes the npm package with provenance
5. Builds Linux and macOS binaries and attaches them to a GitHub Release

This gives users two supported installation paths:

1. npm / npx / pnpx via the published `acai` package
2. Downloaded binaries from GitHub Releases

## What Gets Published

### npm package

The npm package is built from `src/index.ts` using:

```sh
bun run build:npm
```

That produces:

```text
dist/acai.js
```

`package.json` maps the CLI binary name to that built file:

```json
"bin": {
  "acai": "dist/acai.js"
}
```

Because `package.json` also defines `prepack`, the npm publish flow rebuilds the CLI bundle before packaging.

Before `npm publish`, the release workflow now also runs:

```sh
bun run verify:npm-artifact
```

That verification:

1. creates the tarball with `bun pm pack`
2. installs that tarball with `npm install`
3. runs the installed CLI through the npm-installed `node_modules/.bin/acai` entrypoint with a real Node binary from `actions/setup-node`
4. smoke-tests help, `skill`, `push`, `set-status`, and one `--json` stdout/stderr separation path

This specifically closes the gap between Bun source execution and the real npm artifact users install.

### GitHub Release binaries

The release workflow compiles these binaries with `bun build --compile`:

1. `acai-linux-x64`
2. `acai-linux-arm64`
3. `acai-darwin-x64`
4. `acai-darwin-arm64`

It also generates `SHA256SUMS.txt` and uploads all of them to the GitHub Release.

## Release Flow

The workflow has four jobs.

### 1. `validate-release`

This job:

1. checks out the repo
2. installs dependencies with Bun
3. verifies `github.ref_name` matches `package.json` version
4. runs `AGENT=1 bun test`
5. runs `bun run verify:npm-artifact` after provisioning a real Node runtime

If this job fails, nothing is published.

### 2. `publish-npm`

This job publishes the `acai` package to npm using `npm publish --provenance`.

Behavior:

1. stable tags like `v1.2.3` publish normally
2. prerelease tags like `v1.2.3-beta.1` publish to npm using the `next` dist-tag

This job requires the repository secret:

```text
NPM_TOKEN
```

GitHub Actions OIDC provenance is enabled through workflow permissions and `npm publish --provenance`.

### 3. `build-release-binaries`

This job builds compiled release binaries for Linux and macOS on a matrix, then uploads them as workflow artifacts for the final release job.

### 4. `publish-github-release`

This job downloads the compiled artifacts, creates `SHA256SUMS.txt`, and publishes the binaries to the GitHub Release associated with the pushed tag.

Stable tags produce a normal GitHub Release.
Tags containing `-` produce a prerelease.

## How To Cut A Release

### Stable release

1. Update `package.json` version to the final release version
2. Commit the version bump
3. Create a tag that matches the package version exactly
4. Push the commit and tag

Example:

```sh
git tag v0.1.0
git push origin main --tags
```

### Prerelease

Use a semver prerelease version in `package.json`, then tag the same version.

Example:

```sh
git tag v0.2.0-beta.1
git push origin main --tags
```

That will:

1. publish to npm under the `next` dist-tag
2. mark the GitHub Release as a prerelease

## Required Secrets And Permissions

### GitHub Actions permissions

The workflow uses:

1. `contents: write` to publish GitHub Releases
2. `id-token: write` for npm provenance

### Repository secrets

You need:

1. `NPM_TOKEN` for npm publishing

## Common Failure Modes

### Tag/version mismatch

If the tag does not match `package.json`, the workflow fails in `validate-release`.

Example of a mismatch:

1. `package.json` says `0.3.0`
2. pushed tag is `v0.3.1`

Fix by making them match exactly.

### npm publish fails

Check:

1. `NPM_TOKEN` is configured
2. the package name is available or you have publish rights
3. the version has not already been published

### GitHub Release succeeds but assets are missing

Check the `build-release-binaries` job first. The publish job only uploads files that were built and downloaded successfully.

## Local Checks Before Tagging

Recommended local checks:

```sh
AGENT=1 bun test
bun run build:npm
```

If you want to run the same npm-artifact verification used by CI, do it from a shell that has a real Node installation on `PATH`.
The devcontainer's default `node` points to Bun's compatibility fallback and does not count.

```sh
bun run verify:npm-artifact
```

Optional binary checks:

```sh
bun run build:release:linux-x64
bun run build:release:darwin-arm64
```

## Files To Know

1. `package.json`
2. `.github/workflows/release.yml`
3. `src/index.ts`
4. `docs/releasing.md`

## Notes For Maintainers

1. npm users install from the package published by the workflow
2. GitHub users install from release assets published by the workflow
3. This repo currently targets Linux and macOS only
4. Windows binaries are intentionally not part of the current release matrix
