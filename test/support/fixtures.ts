import type { FeatureContextAcidEntry, FeatureContextResponse, FeatureStatesResponse, ImplementationFeatureEntry, ImplementationFeaturesResponse } from "../../src/generated/types.ts";
import type {
	ListImplementationEntry,
	ListImplementationsResponse,
} from "../../src/core/api.ts";

export function buildImplementationFeatureEntry(
  overrides: Partial<ImplementationFeatureEntry> = {},
): ImplementationFeatureEntry {
  return {
    feature_name: "example-feature",
    description: "Example feature",
    completed_count: 1,
    total_count: 3,
    refs_count: 2,
    test_refs_count: 1,
    has_local_spec: true,
    has_local_states: false,
    spec_last_seen_commit: "abc123",
    states_inherited: false,
    refs_inherited: false,
    ...overrides,
  };
}

export function buildImplementationFeaturesResponse(
  overrides: { data?: Partial<ImplementationFeaturesResponse["data"]> } = {},
): ImplementationFeaturesResponse {
  return {
    data: {
      product_name: "example-product",
      implementation_id: "impl-1",
      implementation_name: "main",
      features: [buildImplementationFeatureEntry()],
      ...(overrides.data ?? {}),
    },
  };
}

export function buildImplementationEntry(overrides: Partial<ListImplementationEntry> = {}): ListImplementationEntry {
  return {
    implementation_id: "impl-1",
    implementation_name: "main",
    product_name: "example-product",
    ...overrides,
  };
}

export function buildImplementationsResponse(
  overrides: { data?: Partial<ListImplementationsResponse["data"]> } = {},
): ListImplementationsResponse {
  return {
    data: {
      product_name: "example-product",
      implementations: [buildImplementationEntry()],
      ...(overrides.data ?? {}),
    },
  };
}

export function buildFeatureContextAcidEntry(
  overrides: Partial<FeatureContextAcidEntry> = {},
): FeatureContextAcidEntry {
  return {
    acid: "feature.MAIN.1",
    refs_count: 2,
    requirement: "Expose the command",
    state: {
      status: "completed",
      comment: "implemented",
      updated_at: "2026-04-03T20:06:28Z",
    },
    test_refs_count: 1,
    refs: [
      {
        branch_name: "main",
        is_test: false,
        path: "src/core/feature.ts",
        repo_uri: "github.com/my-org/my-repo",
      },
    ],
    ...overrides,
  };
}

export function buildFeatureContextResponse(
  overrides: { data?: Partial<FeatureContextResponse["data"]> } = {},
): FeatureContextResponse {
  return {
    data: {
      acids: [buildFeatureContextAcidEntry()],
      feature_name: "feature",
      implementation_id: "impl-1",
      implementation_name: "main",
      product_name: "example-product",
      refs_source: { source_type: "local", implementation_name: "main", branch_names: ["main"] },
      spec_source: { source_type: "local", implementation_name: "main", branch_names: ["main"] },
      states_source: { source_type: "local", implementation_name: "main", branch_names: ["main"] },
      summary: {
        status_counts: { completed: 1 } as never,
        total_acids: 1,
      },
      warnings: [],
      ...(overrides.data ?? {}),
    },
  };
}

export function buildFeatureStatesResponse(
  overrides: { data?: Partial<FeatureStatesResponse["data"]> } = {},
): FeatureStatesResponse {
  return {
    data: {
      feature_name: "set-status",
      implementation_id: "impl-1",
      implementation_name: "main",
      product_name: "example-product",
      states_written: 2,
      warnings: [],
      ...(overrides.data ?? {}),
    },
  };
}
