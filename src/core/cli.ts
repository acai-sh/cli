import type { ApiClient } from "./api.ts";
import { createApiClient } from "./api.ts";
import { resolveApiConfig } from "./config.ts";
import { CliError, runtimeError, usageError } from "./errors.ts";
import { defaultOutputPorts, writeJsonResult, writeTextResult, type OutputPorts } from "./output.ts";
import { parseWorkArgs, runWorkCommand } from "./work.ts";

export interface CliDependencies {
  env?: Record<string, string | undefined>;
  output?: OutputPorts;
  apiClient?: ApiClient;
}

export async function runCli(argv: string[], dependencies: CliDependencies = {}): Promise<number> {
  const output = dependencies.output ?? defaultOutputPorts();

  try {
    const parsed = parseWorkArgs(argv);
    if (parsed.command !== "work") {
      throw usageError("Usage: acai work --product <name> [--impl <name>] [--status <value>] [--changed-since-commit <commit>] [--json]");
    }

    const env = dependencies.env ?? process.env;
    const config = resolveApiConfig(env);
    const apiClient = dependencies.apiClient ?? createApiClient(config);
    const result = await runWorkCommand(apiClient, parsed.workArgs);

    if (result.jsonPayload !== undefined) {
      await writeJsonResult(output, result.jsonPayload, result.stderrLines);
    } else {
      await writeTextResult(output, result.stdoutLines ?? [], result.stderrLines);
    }
    return result.exitCode;
  } catch (error) {
    const cliError = toCliError(error);
    await writeTextResult(output, [], [cliError.message]);
    return cliError.exitCode;
  }
}

function toCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (error instanceof Error) return runtimeError(error.message);
  return runtimeError("Unexpected CLI failure.");
}
