import type { FeatureContextResponse } from "../generated/types.ts";
import type { ApiClient } from "./api.ts";
import { usageError } from "./errors.ts";
import { formatTextTable, type CommandResult } from "./output.ts";
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

// feature.MAIN.1
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

// feature.API.1
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
		`TARGET: ${data.product_name}/${data.implementation_name}`,
		`FEATURE: ${data.feature_name}`,
		`TOTAL: ${data.summary.total_acids}`,
		`STATUS: ${formatStatusCounts(data.summary.status_counts as Record<string, number>)}`,
		"",
		...formatTextTable(
			["ACID", "STATUS", "REFS", "TESTS", "REQUIREMENT"],
			data.acids.map((acid) => [
				acid.acid,
				acid.state.status ?? "null",
				acid.refs_count,
				acid.test_refs_count,
				acid.requirement,
			]),
		),
	];

	if (includeRefs) {
		const refs = data.acids.flatMap((acid) =>
			(acid.refs ?? []).map((ref) => [
				acid.acid,
				ref.is_test ? "test" : "code",
				ref.repo_uri,
				ref.branch_name,
				ref.path,
			]),
		);
		if (refs.length > 0) {
			lines.push(
				"",
				"REFS",
				...formatTextTable(["ACID", "TYPE", "REPO", "BRANCH", "PATH"], refs),
			);
		}
	}

	if (data.warnings.length > 0) {
		lines.push("", "WARNINGS", ...data.warnings);
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
