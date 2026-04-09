import type { ApiClient } from "./api.ts";
import { readGitContext } from "./git.ts";
import { runtimeError, usageError } from "./errors.ts";

export interface OneImplementationTarget {
	productName: string;
	implementationName?: string;
}

export interface OneImplementationOptions {
	product?: string;
	impl?: string;
}

export interface OneImplementationResolverDependencies {
	readGitContext?: typeof readGitContext;
}

// feature.MAIN.2 / feature.MAIN.3
export function normalizeOneImplementationTarget(
	options: OneImplementationOptions,
): OneImplementationTarget {
	if (options.product?.startsWith("-")) {
		throw usageError("Missing value for --product.");
	}

	if (options.impl?.startsWith("-")) {
		throw usageError("Missing value for --impl.");
	}

	const scopedTarget = parseScopedImplementationSelector(options.impl);

	if (
		options.product &&
		scopedTarget &&
		options.product !== scopedTarget.productName
	) {
		throw usageError(
			`Conflicting product selectors: --product ${options.product} does not match --impl ${options.impl}.`,
		);
	}

	const productName = options.product ?? scopedTarget?.productName;
	if (!productName) {
		throw usageError(
			"Missing product selector. Provide --product or use --impl <product/implementation>.",
		);
	}

	return {
		productName,
		implementationName: scopedTarget?.implementationName ?? options.impl,
	};
}

export function parseScopedImplementationSelector(
	selector?: string,
): { productName: string; implementationName: string } | undefined {
	if (!selector) {
		return undefined;
	}

	const slashIndex = selector.indexOf("/");
	if (slashIndex <= 0 || slashIndex === selector.length - 1) {
		return undefined;
	}

	const productName = selector.slice(0, slashIndex);
	const implementationName = selector.slice(slashIndex + 1);
	if (!productName || !implementationName || implementationName.includes("/")) {
		return undefined;
	}

	return { productName, implementationName };
}

// cli-core.TARGETING.1
export async function resolveImplementationName(
	apiClient: ApiClient,
	target: OneImplementationTarget,
	dependencies: OneImplementationResolverDependencies = {},
): Promise<string> {
	if (target.implementationName) {
		return target.implementationName;
	}

	const contextReader = dependencies.readGitContext ?? readGitContext;
	const gitContext = await contextReader();
	const response = await apiClient.listImplementations({
		productName: target.productName,
		repoUri: gitContext.repoUri,
		branchName: gitContext.branchName,
	});

	const implementations = response.data.implementations;
	if (implementations.length === 1) {
		return implementations[0]!.implementation_name;
	}

	if (implementations.length === 0) {
		throw runtimeError(
			"No implementation matched the current repo, branch, and product. This branch may not have been pushed yet. Try: acai push --all",
		);
	}

	throw runtimeError(
		`Multiple implementations matched the current repo, branch, and product: ${implementations.map((entry) => entry.implementation_name).join(", ")}`,
	);
}
