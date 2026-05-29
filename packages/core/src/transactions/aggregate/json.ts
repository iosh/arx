/** JSON-compatible value used for namespace-owned payloads. */
export type JsonPrimitive = null | boolean | number | string;

export type JsonObject = {
  [key: string]: JsonValue;
};

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export const cloneJsonValue = <T extends JsonValue>(value: T): T => structuredClone(value) as T;
