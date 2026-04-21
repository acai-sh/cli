import type { ApiClient } from "./api.ts";
import { usageError } from "./errors.ts";
import { formatTextTable, type CommandResult } from "./output.ts";
import {
	normalizeOneImplementationTarget,
	resolveImplementationTarget,
	type OneImplementationResolverDependencies,
} from "./targeting.ts";

export interface FeaturesArgs {
	productName?: string;
	implementationName?: string;
	implementationFilter?: string;
	statuses: string[];
	changedSinceCommit?: string;
	json: boolean;
}

export interface FeaturesCommandOptions {
	product?: string;
	impl?: string;
	status?: string[];
	changedSinceCommit?: string;
	json?: boolean;
}

export type FeaturesTargetResolverDependencies =
	OneImplementationResolverDependencies;

// features.MAIN.1 / features.MAIN.2 / features.MAIN.3
export function normalizeFeaturesOptions(
	options: FeaturesCommandOptions,
): FeaturesArgs {
	const target = normalizeOneImplementationTarget(options, {
		requireProduct: false,
	});

	// features.MAIN.5
	if (options.changedSinceCommit?.startsWith("-")) {
		throw usageError("Missing value for --changed-since-commit.");
	}

	// features.MAIN.4
	const statuses = options.status ?? [];
	for (const status of statuses) {
		if (status.startsWith("-")) {
			throw usageError("Missing value for --status.");
		}
	}

	return {
		productName: target.productName,
		implementationName: target.implementationName,
		implementationFilter: target.implementationFilter,
		statuses,
		changedSinceCommit: options.changedSinceCommit,
		json: options.json ?? false,
	};
}

export async function runFeaturesCommand(
	apiClient: ApiClient,
	args: FeaturesArgs,
	dependencies: FeaturesTargetResolverDependencies = {},
): Promise<CommandResult> {
	// features.UX.2
	const target = await resolveImplementationTarget(
		apiClient,
		{
			productName: args.productName,
			implementationName: args.implementationName,
			implementationFilter: args.implementationFilter,
		},
		dependencies,
	);

	// features.API.1 / features.UX.2
	const response = await apiClient.listImplementationFeatures({
		productName: target.productName,
		implementationName: target.implementationName,
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
		stdoutLines: formatTextTable(
			["FEATURE", "DONE", "REFS", "TESTS", "SPEC", "STATES", "LAST_SEEN"],
			// features.API.2 / features.UX.3
			features.map((feature) => [
				feature.feature_name,
				`${feature.completed_count}/${feature.total_count}`,
				feature.refs_count,
				feature.test_refs_count,
				feature.has_local_spec ? "local" : "inherited",
				feature.has_local_states
					? feature.states_inherited
						? "inherited"
						: "local"
					: "none",
				feature.spec_last_seen_commit,
			]),
		),
	};
}
