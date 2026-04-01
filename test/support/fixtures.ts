import type { ImplementationFeatureEntry, ImplementationFeaturesResponse, ImplementationEntry, ImplementationsResponse } from "../../src/generated/types.ts";

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

export function buildImplementationEntry(overrides: Partial<ImplementationEntry> = {}): ImplementationEntry {
  return {
    implementation_id: "impl-1",
    implementation_name: "main",
    ...overrides,
  };
}

export function buildImplementationsResponse(
  overrides: { data?: Partial<ImplementationsResponse["data"]> } = {},
): ImplementationsResponse {
  return {
    data: {
      product_name: "example-product",
      implementations: [buildImplementationEntry()],
      ...(overrides.data ?? {}),
    },
  };
}
