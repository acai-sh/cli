import { Command, CommanderError } from "commander";
import type { ApiClient } from "./api.ts";
import { createApiClient } from "./api.ts";
import { resolveApiConfig } from "./config.ts";
import { CliError, runtimeError } from "./errors.ts";
import {
    defaultOutputPorts,
    writeJsonResult,
    writeTextResult,
    type CommandResult,
    type OutputPorts,
} from "./output.ts";
import {
    normalizeWorkOptions,
    runWorkCommand,
    type WorkCommandOptions,
} from "./work.ts";

export interface CliDependencies {
    env?: Record<string, string | undefined>;
    output?: OutputPorts;
    apiClient?: ApiClient;
}

interface CliState {
    workResult?: CommandResult;
    usageError?: CliError;
    usageHelpCommand?: string;
}

export async function runCli(
    argv: string[],
    dependencies: CliDependencies = {},
): Promise<number> {
    const output = dependencies.output ?? defaultOutputPorts();
    const { program, state } = createCliProgram(dependencies, output);

    if (argv.length === 0) {
        // cli-core.HELP.1 / cli-core.HELP.4
        program.outputHelp();
        return 0;
    }

    try {
        await program.parseAsync(argv, { from: "user" });
    } catch (error) {
        if (error instanceof CommanderError) {
            return handleCommanderError(error);
        }

        const cliError =
            error instanceof CliError
                ? error
                : runtimeError(
                      error instanceof Error
                          ? error.message
                          : "Unexpected CLI failure.",
                  );
        await writeTextResult(output, [], [cliError.message]);
        return cliError.exitCode;
    }

    if (state?.usageError) {
        // cli-core.ERRORS.5
        await writeTextResult(
            output,
            [],
            [
                state.usageError.message,
                getCommandHelp(program, state.usageHelpCommand ?? "work"),
            ],
        );
        return state.usageError.exitCode;
    }

    if (state?.workResult) {
        const result = state.workResult;
        if (result.jsonPayload !== undefined) {
            await writeJsonResult(
                output,
                result.jsonPayload,
                result.stderrLines,
            );
        } else {
            await writeTextResult(
                output,
                result.stdoutLines ?? [],
                result.stderrLines,
            );
        }
        return result.exitCode;
    }

    return 0;
}

function createCliProgram(
    dependencies: CliDependencies,
    output: OutputPorts,
): { program: Command; state: CliState } {
    const state: CliState = {};
    const env = dependencies.env ?? process.env;

    const program = new Command();
    program
        .name("acai")
        .description(
            "CLI and toolkit to assist spec-driven development. Use acai to push local specs (feature.yaml) and inline code references (ACIDs) to an acai.sh server, and to apply status updates and annotations. Or use acai to fetch data and discover work.",
        )
        .showHelpAfterError(true)
        .exitOverride()
        // cli-core.HELP.1 / cli-core.HELP.2 / cli-core.HELP.3 / cli-core.ERRORS.3 / cli-core.ERRORS.4 / cli-core.ERRORS.5
        .configureOutput({
            writeOut: (text) => void output.stdout.write(text),
            writeErr: (text) => void output.stderr.write(text),
        });

    program
        .command("work")
        .usage("--product <name> [options]")
        .description(
            "Get a summary of features for the given product + implementation. The summary includes status & reference counts, inheritance, and metadata. Use this to understand what exists and what to work on next. When --impl is omitted, acai resolves the current implementation from the git branch.",
        )
        // work.MAIN.2
        .requiredOption("--product <name>", "product name (required)")
        .option(
            "--impl <name>",
            "implementation name (defaults to the current git-resolved implementation)",
        )
        .option(
            "--status <value>",
            "status filter",
            (value: string, previous: string[] = []) => [...previous, value],
        )
        .option("--changed-since-commit <commit>", "filter by commit")
        .option("--json", "emit JSON output")
        .action(async (options: WorkCommandOptions) => {
            try {
                const workArgs = normalizeWorkOptions(options);
                const apiClient =
                    dependencies.apiClient ??
                    createApiClient(resolveApiConfig(env));
                state.workResult = await runWorkCommand(apiClient, workArgs);
            } catch (error) {
                if (error instanceof CliError && error.kind === "usage") {
                    state.usageHelpCommand = "work";
                    state.usageError = error;
                    return;
                }

                throw error;
            }
        });

    return { program, state };
}

function getCommandHelp(program: Command, commandName: string): string {
    const command = program.commands.find(
        (entry) => entry.name() === commandName,
    );
    return (
        command?.helpInformation().trimEnd() ??
        program.helpInformation().trimEnd()
    );
}

function handleCommanderError(error: unknown): number {
    if (error instanceof CommanderError) {
        if (error.code === "commander.helpDisplayed") return 0;
        if (
            error.code === "commander.unknownCommand" ||
            error.code === "commander.unknownOption" ||
            error.code === "commander.missingArgument" ||
            error.code === "commander.missingMandatoryOptionValue" ||
            error.code === "commander.optionMissingArgument" ||
            error.code === "commander.excessArguments"
        ) {
            return 2;
        }
        return error.exitCode || 1;
    }

    if (error instanceof CliError) return error.exitCode;
    if (error instanceof Error) return runtimeError(error.message).exitCode;
    return runtimeError("Unexpected CLI failure.").exitCode;
}
