[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

# Acai.sh CLI

The `acai` Command-line Interface helps you (or your agent, or script) perform common actions related to spec-driven development with Acai.

Primarily, it is used to push and pull specs and metadata to an acai server, and to read implementation status and notes from the server as well.

It works with our official hosted server, or your own self-hosted instance.

For Quickstart, docs and tutorials see [https://acai.sh](https://acai.sh).

## Install

The CLI is available on NPM as a JavaScript bundle.
```sh
npm i -g @acai.sh/cli
```

If you don't have a JavaScript runtime, we have macOS and Linux releases available on GitHub.

## Project overview

The CLI is written in TypeScript with `bun` and `commander`. It is aligned to the Acai.sh API using `openapi-fetch` and `openapi-typescript`.

## Local development
The repo includes a `.devcontainer.json` so you can get up and running quickly.
`devpod` cli is recommended but not required.

```sh
# from cli repo root
devpod up .
```

If you don't have devpod, you can open the repo in Zed/VSCode and click "open in devcontainer".

## License
Apache 2.0. Contributors must sign a Contributor License Agreement. You are free to use, modify, and distribute this software, including for commercial purposes, under the terms of the license.
