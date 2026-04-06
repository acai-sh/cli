#!/usr/bin/env node
import { runCli } from "./core/cli.ts";

const exitCode = await runCli(Bun.argv.slice(2));
process.exitCode = exitCode;
