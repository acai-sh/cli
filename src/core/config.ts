import { usageError } from "./errors.ts";

export interface ApiConfig {
  baseUrl: string;
  token: string;
}

export interface EnvLike {
  [key: string]: string | undefined;
}

// cli-core.CONFIG.1, cli-core.CONFIG.2, and cli-core.AUTH.2
export function resolveApiConfig(env: EnvLike = process.env): ApiConfig {
  const baseUrl = env.ACAI_API_BASE_URL ?? env.ACAI_API_URL ?? "https://acai.sh/api/v1";

  const token = env.ACAI_API_TOKEN;
  if (!token) {
    throw usageError("Missing API bearer token configuration.");
  }

  return { baseUrl, token };
}
