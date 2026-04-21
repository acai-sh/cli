#!/usr/bin/env node
import { runCli } from "./core/cli.ts";
import { defaultRuntime } from "./core/runtime.ts";

const exitCode = await runCli(defaultRuntime.getArgv().slice(2));
process.exitCode = exitCode;
