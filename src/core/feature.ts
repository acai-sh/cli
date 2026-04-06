import type { FeatureContextResponse } from "../generated/types.ts";
import type { ApiClient } from "./api.ts";
import { usageError } from "./errors.ts";
import type { CommandResult } from "./output.ts";
import {
  normalizeOneImplementationTarget,
  resolveImplementationName,
  type OneImplementationResolverDependencies,
} from "./targeting.ts";

export interface FeatureArgs {
  featureName: string;
  productName: string;
  implementationName?: string;
  statuses: string[];
  includeRefs: boolean;
  json: boolean;
}

export interface FeatureCommandOptions {
  product?: string;
  impl?: string;
  status?: string[];
  includeRefs?: boolean;
  json?: boolean;
}

// feature.MAIN.1 / feature.MAIN.2 / feature.MAIN.3 / feature.MAIN.4 / feature.MAIN.5 / feature.MAIN.6
export function normalizeFeatureOptions(
  featureName: string,
  options: FeatureCommandOptions,
): FeatureArgs {
  if (!featureName || featureName.startsWith("-")) {
    throw usageError("Missing value for <feature-name>.");
  }

  const target = normalizeOneImplementationTarget(options);
  const statuses = options.status ?? [];
  for (const status of statuses) {
    if (status.startsWith("-")) {
      throw usageError("Missing value for --status.");
    }
  }

  return {
    featureName,
    productName: target.productName,
    implementationName: target.implementationName,
    statuses,
    includeRefs: options.includeRefs ?? false,
    json: options.json ?? false,
  };
}

// feature.API.1 / feature.API.2 / feature.API.3 / feature.UX.1 / feature.UX.2 / cli-core.OUTPUT.1 / cli-core.OUTPUT.2
export async function runFeatureCommand(
  apiClient: ApiClient,
  args: FeatureArgs,
  dependencies: OneImplementationResolverDependencies = {},
): Promise<CommandResult> {
  const implementationName = await resolveImplementationName(
    apiClient,
    {
      productName: args.productName,
      implementationName: args.implementationName,
    },
    dependencies,
  );

  const response = await apiClient.getFeatureContext({
    productName: args.productName,
    featureName: args.featureName,
    implementationName,
    statuses: args.statuses.length > 0 ? args.statuses : undefined,
    includeRefs: args.includeRefs,
  });

  if (args.json) {
    return {
      exitCode: 0,
      jsonPayload: response,
      stderrLines: response.data.warnings,
    };
  }

  return {
    exitCode: 0,
    stdoutLines: formatFeatureContext(response, args.includeRefs),
  };
}

export function formatFeatureContext(
  response: FeatureContextResponse,
  includeRefs: boolean,
): string[] {
  const { data } = response;
  const lines = [
    `${data.product_name}/${data.implementation_name} feature=${data.feature_name}`,
    `summary total_acids=${data.summary.total_acids} status_counts=${formatStatusCounts(data.summary.status_counts as Record<string, number>)}`,
  ];

  for (const acid of data.acids) {
    lines.push(
      `${acid.acid} status=${acid.state.status ?? "null"} refs=${acid.refs_count} test_refs=${acid.test_refs_count} requirement=${acid.requirement}`,
    );

    if (includeRefs) {
      for (const ref of acid.refs ?? []) {
        lines.push(
          `  ref repo=${ref.repo_uri} branch=${ref.branch_name} path=${ref.path} is_test=${ref.is_test}`,
        );
      }
    }
  }

  for (const warning of data.warnings) {
    lines.push(`warning: ${warning}`);
  }

  return lines;
}

function formatStatusCounts(statusCounts: Record<string, number>): string {
  const entries = Object.entries(statusCounts);
  if (entries.length === 0) {
    return "none";
  }

  return entries.map(([status, count]) => `${status}:${count}`).join(",");
}
