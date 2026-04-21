# Security Checklist

Created April 21, 2026 by GPT 5.4-high
Reviewed April 21, 2026 by Atmosfearful

## Identity And Access

- [x] Publish through an npm organization, not a single personal account.
- [x] Require passkey 2FA for npm and GitHub admins.
- [x] Keep the maintainer/admin list small and review it regularly.

## Branch Protection

- [x] Protect `main` and require pull requests for changes.
- [x] Prevent direct pushes, force pushes, and branch deletion on `main`.
- [x] Require passing CI before merge.
- [x] Require signed commits.

## Publishing Controls

- [x] Publish only from CI, never from a maintainer workstation.
- [x] Use npm trusted publishing with GitHub Actions OIDC.
- [x] Do not use long-lived npm publish tokens.
- [x] Restrict publishing to the `npm` environment defined in the workflow.

## Release Integrity

- [x] Grant `id-token: write` only to the publish job.
- [x] Pin Bun and Node versions in CI.
- [x] Commit the lockfile and install with frozen lockfile mode.
- [x] Run the full test suite before any publish step.
- [x] Verify the actual npm tarball from `npm pack`, not just source execution.
- [x] Install and smoke-test the packed tarball under the runtime users actually use.
- [x] Fail the release if the tag version and `package.json` version do not match.

## Supply chain
- [x] Enforce a 7-day minimum release age for newly resolved dependencies via `bunfig.toml`.
- [x] This package does not use consumer lifecycle scripts such as `postinstall`.
- [x] Bun does not execute installed dependency lifecycle scripts by default.

## Artifact Trust

- [x] Publish npm packages with `npm publish --provenance`.
- [x] Attach checksums for standalone binaries and other release artifacts.
