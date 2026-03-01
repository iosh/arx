import type { JsonValue } from "./json.js";

export type JsonRpcErrorObject = {
  code: number;
  message: string;
  data?: JsonValue;
};

