import type { ApiClient } from "./api.ts";
import { readGitContext } from "./git.ts";
import { runtimeError, usageError } from "./errors.ts";
import type { CommandResult } from "./output.ts";

export interface WorkArgs {
  productName: string;
  implementationName?: string;
  statuses: string[];
  changedSinceCommit?: string;
  json: boolean;
}

export interface WorkTargetResolverDependencies {
  readGitContext?: typeof readGitContext;
}

export function parseWorkArgs(argv: string[]): { command: string | null; workArgs: WorkArgs } {
  const args = argv.slice();
  const command = args.shift() ?? null;
  const workArgs: WorkArgs = { productName: "", statuses: [], json: false };

  while (args.length > 0) {
    const flag = args.shift();
    if (!flag) break;

    switch (flag) {
      case "--json":
        workArgs.json = true;
        break;
      case "--product":
        workArgs.productName = requireValue(flag, args);
        break;
      case "--impl":
        workArgs.implementationName = requireValue(flag, args);
        break;
      case "--status":
        workArgs.statuses.push(requireValue(flag, args));
        break;
      case "--changed-since-commit":
        workArgs.changedSinceCommit = requireValue(flag, args);
        break;
      default:
        throw usageError(`Unknown flag: ${flag}`);
    }
  }

  if (!workArgs.productName) {
    throw usageError("Missing required --product value.");
  }

  return { command, workArgs };
}

export async function runWorkCommand(
  apiClient: ApiClient,
  args: WorkArgs,
  dependencies: WorkTargetResolverDependencies = {},
): Promise<CommandResult> {
  const implementationName = args.implementationName ?? (await resolveImplementationName(apiClient, args.productName, dependencies));

  const response = await apiClient.listImplementationFeatures({
    productName: args.productName,
    implementationName,
    statuses: args.statuses.length > 0 ? args.statuses : undefined,
    changedSinceCommit: args.changedSinceCommit,
  });

  const features = response.data.features;
  if (args.json) {
    return { exitCode: 0, jsonPayload: response };
  }

  if (features.length === 0) {
    return {
      exitCode: 0,
      stdoutLines: ["No features were returned."],
    };
  }

  return {
    exitCode: 0,
    stdoutLines: features.map((feature) => `${feature.feature_name} ${feature.completed_count}/${feature.total_count} refs_count=${feature.refs_count}`),
  };
}

async function resolveImplementationName(
  apiClient: ApiClient,
  productName: string,
  dependencies: WorkTargetResolverDependencies,
): Promise<string> {
  const contextReader = dependencies.readGitContext ?? readGitContext;
  const gitContext = await contextReader();
  const response = await apiClient.listImplementations({
    productName,
    repoUri: gitContext.repoUri,
    branchName: gitContext.branchName,
  });

  const implementations = response.data.implementations;
  if (implementations.length === 1) {
    return implementations[0]!.implementation_name;
  }

  if (implementations.length === 0) {
    throw runtimeError("No implementation matched the current repo, branch, and product.");
  }

  throw runtimeError(
    `Multiple implementations matched the current repo, branch, and product: ${implementations.map((entry) => entry.implementation_name).join(", ")}`,
  );
}

function requireValue(flag: string, args: string[]): string {
  const value = args.shift();
  if (!value || value.startsWith("--")) throw usageError(`Missing value for ${flag}.`);
  return value;
}
