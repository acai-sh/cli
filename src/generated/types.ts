export type {
  components,
  operations,
  paths,
} from "./openapi.ts";

export type ImplementationEntry = import("./openapi.ts").components["schemas"]["ImplementationEntry"];
export type ImplementationFeatureEntry = import("./openapi.ts").components["schemas"]["ImplementationFeaturesResponse"]["data"]["features"][number];
export type ImplementationFeaturesResponse = import("./openapi.ts").components["schemas"]["ImplementationFeaturesResponse"];
export type ImplementationsResponse = import("./openapi.ts").components["schemas"]["ImplementationsResponse"];
export type ErrorResponse = import("./openapi.ts").components["schemas"]["ErrorResponse"];
export type PushRequest = import("./openapi.ts").components["schemas"]["PushRequest"];
export type PushResponse = import("./openapi.ts").components["schemas"]["PushResponse"];
