import createClient from "openapi-fetch";
import type { paths } from "../generated/types.ts";
import { runtimeError } from "./errors.ts";
import type { ApiConfig } from "./config.ts";

export interface ApiClient {
  listImplementations(input: {
    productName: string;
    repoUri?: string;
    branchName?: string;
    featureName?: string;
  }): Promise<paths["/implementations"]["get"]["responses"][200]["content"]["application/json"]>;
  listImplementationFeatures(input: {
    productName: string;
    implementationName: string;
    statuses?: string[];
    changedSinceCommit?: string;
  }): Promise<paths["/implementation-features"]["get"]["responses"][200]["content"]["application/json"]>;
  getFeatureContext(input: {
    productName: string;
    featureName: string;
    implementationName: string;
    includeRefs?: boolean;
    statuses?: string[];
  }): Promise<paths["/feature-context"]["get"]["responses"][200]["content"]["application/json"]>;
  setFeatureStates(input: NonNullable<paths["/feature-states"]["patch"]["requestBody"]>["content"]["application/json"]): Promise<paths["/feature-states"]["patch"]["responses"][200]["content"]["application/json"]>;
  push(input: NonNullable<paths["/push"]["post"]["requestBody"]>["content"]["application/json"]): Promise<paths["/push"]["post"]["responses"][200]["content"]["application/json"]>;
}

export interface CreateApiClientOptions {
  client?: {
    GET: (path: string, options: Record<string, unknown>) => Promise<any>;
    POST: (path: string, options: Record<string, unknown>) => Promise<any>;
    PATCH?: (path: string, options: Record<string, unknown>) => Promise<any>;
  };
}

export function createApiClient(config: ApiConfig, options: CreateApiClientOptions = {}): ApiClient {
  // cli-core.AUTH.1
  const client: any =
    options.client ??
    createClient<paths>({
      baseUrl: config.baseUrl,
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    });

  return {
    async listImplementations(input) {
      return request(client, "GET", "/implementations", {
        params: {
          query: {
            product_name: input.productName,
            repo_uri: input.repoUri,
            branch_name: input.branchName,
            feature_name: input.featureName,
          },
        },
      });
    },
    async listImplementationFeatures(input) {
      return request(client, "GET", "/implementation-features", {
        params: {
          query: {
            product_name: input.productName,
            implementation_name: input.implementationName,
            statuses: input.statuses,
            changed_since_commit: input.changedSinceCommit,
          },
        },
      });
    },
    async getFeatureContext(input) {
      return request(client, "GET", "/feature-context", {
        params: {
          query: {
            product_name: input.productName,
            feature_name: input.featureName,
            implementation_name: input.implementationName,
            include_refs: input.includeRefs,
            statuses: input.statuses,
          },
        },
      });
    },
    async push(input) {
      return request(client, "POST", "/push", {
        body: input,
      });
    },
    async setFeatureStates(input) {
      return request(client, "PATCH", "/feature-states", {
        body: input,
      });
    },
  };
}

// cli-core.HTTP.1 / cli-core.HTTP.2 / cli-core.HTTP.3 / cli-core.ERRORS.1 / cli-core.ERRORS.6
async function request(
  client: any,
  method: "GET" | "POST" | "PATCH",
  path: string,
  options: Record<string, unknown>,
): Promise<any> {
  try {
    const response = await client[method](path, options);
    if (response?.error) {
      throw normalizeApiResponseError(response.error, response.response?.status);
    }

    if (response?.data !== undefined) {
      return response.data;
    }

    throw normalizeApiResponseError(undefined, response?.response?.status);
  } catch (error) {
    if (error instanceof Error && error.name === "CliError") {
      throw error;
    }
    throw runtimeError("API request failed. Check ACAI_API_BASE_URL and that the server is reachable.", undefined, error);
  }
}

function normalizeApiResponseError(error: unknown, status?: number) {
  const detail = extractErrorDetail(error);
  const message = detail ?? (status === undefined
    ? "API request failed. Check ACAI_API_BASE_URL and that the server is reachable."
    : `API request failed with status ${status}.`);
  return runtimeError(message, detail, error);
}

function extractErrorDetail(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const maybe = error as { errors?: { detail?: unknown } };
  return typeof maybe.errors?.detail === "string" ? maybe.errors.detail : undefined;
}
