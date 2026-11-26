import type { JsonObject, JsonValue } from "../errors.js";

export type JsonRpcParams = readonly JsonValue[] | JsonObject;
