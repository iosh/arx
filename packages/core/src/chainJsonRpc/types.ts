import type { JsonObject, JsonValue } from "../errors.js";

export type JsonRpcParams = readonly JsonValue[] | JsonObject;

export type JsonRpcRequest = Readonly<{
  method: string;
  params?: JsonRpcParams;
}>;
