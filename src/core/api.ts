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
}

export interface CreateApiClientOptions {
  client?: {
    GET: (path: string, options: Record<string, unknown>) => Promise<any>;
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
      return request(client, "/implementations", {
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
      return request(client, "/implementation-features", {
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
  };
}

// cli-core.HTTP.1 / cli-core.HTTP.2 / cli-core.HTTP.3 / cli-core.ERRORS.1
async function request(
  client: any,
  path: string,
  options: Record<string, unknown>,
): Promise<any> {
  try {
    const response = await client.GET(path, options);
    if (response?.error) {
      throw normalizeApiResponseError(response.error, response.response?.status);
    }
    return response.data;
  } catch (error) {
    if (error instanceof Error && error.name === "CliError") {
      throw error;
    }
    throw runtimeError("API request failed.", undefined, error);
  }
}

function normalizeApiResponseError(error: unknown, status?: number) {
  const detail = extractErrorDetail(error);
  const message = detail ?? `API request failed with status ${status ?? "unknown"}.`;
  return runtimeError(message, detail, error);
}

function extractErrorDetail(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const maybe = error as { errors?: { detail?: unknown } };
  return typeof maybe.errors?.detail === "string" ? maybe.errors.detail : undefined;
}
