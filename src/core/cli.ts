import { Command, CommanderError } from "commander";
import type { ApiClient } from "./api.ts";
import { createApiClient } from "./api.ts";
import { resolveApiConfig } from "./config.ts";
import { CliError, runtimeError } from "./errors.ts";
import {
    defaultOutputPorts,
    writeCommandResult,
    writeTextResult,
    type CommandResult,
    type OutputPorts,
} from "./output.ts";
import {
    normalizeFeaturesOptions,
    runFeaturesCommand,
    type FeaturesCommandOptions,
} from "./features.ts";
import {
    normalizeFeatureOptions,
    runFeatureCommand,
    type FeatureCommandOptions,
} from "./feature.ts";
import {
    normalizePushOptions,
    planPush,
    runPushCommand,
    type PushCommandOptions,
} from "./push.ts";
import {
    normalizeSetStatusOptions,
    runSetStatusCommand,
    type SetStatusCommandOptions,
} from "./set-status.ts";
import {
    normalizeSkillOptions,
    runSkillCommand,
    type SkillCommandOptions,
} from "./skill.ts";

export interface CliDependencies {
    env?: Record<string, string | undefined>;
    output?: OutputPorts;
    apiClient?: ApiClient;
}

interface CliState {
    featureResult?: CommandResult;
    featuresResult?: CommandResult;
    pushResult?: CommandResult;
    setStatusResult?: CommandResult;
    skillResult?: CommandResult;
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
                getCommandHelp(program, state.usageHelpCommand ?? "features"),
            ],
        );
        return state.usageError.exitCode;
    }

    if (state?.featuresResult) {
        await writeCommandResult(output, state.featuresResult);
        return state.featuresResult.exitCode;
    }

    if (state?.featureResult) {
        await writeCommandResult(output, state.featureResult);
        return state.featureResult.exitCode;
    }

    if (state?.pushResult) {
        await writeCommandResult(output, state.pushResult);
        return state.pushResult.exitCode;
    }

    if (state?.setStatusResult) {
        await writeCommandResult(output, state.setStatusResult);
        return state.setStatusResult.exitCode;
    }

    if (state?.skillResult) {
        await writeCommandResult(output, state.skillResult);
        return state.skillResult.exitCode;
    }

    return 0;
}

function createCliProgram(
    dependencies: CliDependencies,
    output: OutputPorts,
): { program: Command; state: CliState } {
    const state: CliState = {};
    const env = dependencies.env ?? process.env;
    const purple = "\x1b[38;2;217;66;189m";
    const bold = "\x1b[1m";
    const dim = "\x1b[2m";
    const reset = "\x1b[0m";
    const program = new Command();
    program
        .name("acai")
        .description(
            `  ${purple}${bold}Acai helps you coordinate spec-driven software projects.${reset}

  ${purple}•${reset} Specs are written in local .yaml files (e.g. ${dim}my-feature.feature.yaml${reset}).
  ${purple}•${reset} Specs contain a list of functional acceptance criteria with stable IDs (AKA 'ACIDs').
  ${purple}•${reset} A Product can have many Features, and many Implementations. (e.g. ${dim}my-cli${reset} Product has a ${dim}dev${reset} Implementation with ${dim}my-new-command.feature.yaml${reset})
  ${purple}•${reset} An Implementation tracks specific git branches (e.g. 'Production' tracks 'main'), and optionally a parent implementation from which to inherit data.
  ${purple}•${reset} The Acai.sh server is a hub to help humans and AI agents coordinate across all Products, Features, and Implementations.

  ${purple}🔗${reset} ${bold}Official Docs:${reset}  ${purple}https://acai.sh${reset}
  ${purple}🤖${reset} ${bold}AI/LLM Docs:${reset}    https://acai.sh/llms.txt

  ${dim}Use these commands after editing specs, implementing code, or to identify and self-assign remaining work.${reset}`,
        )
        // cli-core.HELP.1 / cli-core.HELP.2 / cli-core.HELP.3
        .showHelpAfterError(true)
        .exitOverride()
        // cli-core.ERRORS.3 / cli-core.ERRORS.4 / cli-core.ERRORS.5
        .configureOutput({
            writeOut: (text) => void output.stdout.write(text),
            writeErr: (text) => void output.stderr.write(text),
        });

    program
        .command("push")
        .usage("[feature-names...] [options]")
        .description(
            `The ${dim}\`push\`${reset} command is used to scan your git repository and sync local specs and ACID refs to the server. Use feature names to limit the scan, or --all to scan the full repo.\n`,
        )
        // push.MAIN.1 / push.MAIN.2 / push.MAIN.3 / push.MAIN.4 / push.MAIN.5 / push.MAIN.6
        .argument("[feature-names...]")
        .option("--all", "scan all eligible specs and refs from repo root")
        .option(
            "--product <name>",
            "explicit product name for refs-only pushes",
        )
        .option("--target <selector>", "target implementation selector")
        .option("--parent <selector>", "parent implementation selector")
        .option("--json", "emit JSON output")
        .action(async (featureNames: string[], options: PushCommandOptions) => {
            try {
                const pushArgs = normalizePushOptions({
                    featureNames,
                    all: options.all,
                    product: options.product,
                    target: options.target,
                    parent: options.parent,
                    json: options.json,
                });
                const pushPlan = await planPush({
                    cwd: process.cwd(),
                    featureNames: pushArgs.all
                        ? undefined
                        : pushArgs.featureNames,
                    product: pushArgs.product,
                    target: pushArgs.target,
                    parent: pushArgs.parent,
                });
                const apiClient =
                    dependencies.apiClient ??
                    createApiClient(resolveApiConfig(env));
                state.pushResult = await runPushCommand(
                    apiClient,
                    pushArgs,
                    {
                        cwd: process.cwd(),
                    },
                    pushPlan,
                );
            } catch (error) {
                if (error instanceof CliError && error.kind === "usage") {
                    state.usageHelpCommand = "push";
                    state.usageError = error;
                    return;
                }

                throw error;
            }
        });

    program
        .command("feature")
        .usage("<feature-name> [options]")
        .description(
            `The ${dim}\`feature\`${reset} command fetches all context for the given Feature, including a list of all acceptance criteria in the spec. Each entry includes the ACID, status (for the chosen Implementation), comment, and a list of file paths to ACID references found in source code.\n`,
        )
        // feature.MAIN.1
        .argument("<feature-name>")
        // feature.MAIN.2
        .option("--product <name>", "product name")
        // feature.MAIN.3
        .option(
            "--impl <name>",
            "implementation name or namespaced selector <product/implementation>",
        )
        // feature.MAIN.5
        .option(
            "--status <value>",
            "status filter",
            (value: string, previous: string[] = []) => [...previous, value],
        )
        // feature.MAIN.4
        .option("--include-refs", "include per-ACID refs")
        // feature.MAIN.6
        .option("--json", "emit JSON output")
        .action(async (featureName: string, options: FeatureCommandOptions) => {
            try {
                const featureArgs = normalizeFeatureOptions(
                    featureName,
                    options,
                );
                const apiClient =
                    dependencies.apiClient ??
                    createApiClient(resolveApiConfig(env));
                state.featureResult = await runFeatureCommand(
                    apiClient,
                    featureArgs,
                );
            } catch (error) {
                if (error instanceof CliError && error.kind === "usage") {
                    state.usageHelpCommand = "feature";
                    state.usageError = error;
                    return;
                }

                throw error;
            }
        });

    program
        .command("features")
        .usage("--product <name> [options]")
        .description(
            `The ${dim}\`features\`${reset} command fetches a summary list of known features for the given Product. The summary includes status & reference counts, inheritance, and metadata. Use this to understand what exists and what to work on next. When --impl is omitted, acai resolves the current implementation from the git branch.\n`,
        )
        // features.MAIN.2
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
        .action(async (options: FeaturesCommandOptions) => {
            try {
                const featuresArgs = normalizeFeaturesOptions(options);
                const apiClient =
                    dependencies.apiClient ??
                    createApiClient(resolveApiConfig(env));
                state.featuresResult = await runFeaturesCommand(
                    apiClient,
                    featuresArgs,
                );
            } catch (error) {
                if (error instanceof CliError && error.kind === "usage") {
                    state.usageHelpCommand = "features";
                    state.usageError = error;
                    return;
                }

                throw error;
            }
        });

    program
        .command("skill")
        .usage("[options]")
        .description(
            `The ${dim}\`skill\`${reset} command prints the canonical bundled acai agent skill markdown, or installs that same content into the current workspace with ${dim}--install${reset}.\n`,
        )
        // skill.MAIN.1 / skill.MAIN.4
        .option(
            "--install",
            "write the bundled acai skill to .agents/skills/acai/SKILL.md",
        )
        .action(async (options: SkillCommandOptions) => {
            state.skillResult = await runSkillCommand(
                normalizeSkillOptions(options),
                {
                    cwd: process.cwd(),
                },
            );
        });

    program
        .command("set-status")
        .usage("<json> [options]")
        .description(
            `The ${dim}\`set-status\`${reset} command is used to write status updates to the server. This is useful for sharing work progress or flagging issues. Accepts status and comments for a batch of requirements (ACIDs) for a single Implementation of a single Feature.\n`,
        )
        // set-status.MAIN.1 / set-status.MAIN.2 / set-status.MAIN.3 / set-status.MAIN.4 / set-status.MAIN.5 / set-status.MAIN.6
        .argument("<json>")
        .option("--product <name>", "product name")
        .option(
            "--impl <name>",
            "implementation name or namespaced selector <product/implementation>",
        )
        .option("--json", "emit JSON output")
        .action(async (source: string, options: SetStatusCommandOptions) => {
            try {
                const setStatusArgs = normalizeSetStatusOptions(
                    source,
                    options,
                );
                const apiClient =
                    dependencies.apiClient ??
                    createApiClient(resolveApiConfig(env));
                state.setStatusResult = await runSetStatusCommand(
                    apiClient,
                    setStatusArgs,
                );
            } catch (error) {
                if (error instanceof CliError && error.kind === "usage") {
                    state.usageHelpCommand = "set-status";
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
