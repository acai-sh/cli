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

export interface WorkCommandOptions {
  product?: string;
  impl?: string;
  status?: string[];
  changedSinceCommit?: string;
  json?: boolean;
}

export interface WorkTargetResolverDependencies {
  readGitContext?: typeof readGitContext;
}

// work.MAIN.1 / cli-core.TARGETING.1
export function normalizeWorkOptions(options: WorkCommandOptions): WorkArgs {
  if (!options.product) {
    throw usageError("Missing required --product value.");
  }

  if (options.product.startsWith("-")) {
    throw usageError("Missing value for --product.");
  }

  if (options.impl?.startsWith("-")) {
    throw usageError("Missing value for --impl.");
  }

  if (options.changedSinceCommit?.startsWith("-")) {
    throw usageError("Missing value for --changed-since-commit.");
  }

  const statuses = options.status ?? [];
  for (const status of statuses) {
    if (status.startsWith("-")) {
      throw usageError("Missing value for --status.");
    }
  }

  return {
    productName: options.product,
    implementationName: options.impl,
    statuses,
    changedSinceCommit: options.changedSinceCommit,
    json: options.json ?? false,
  };
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
