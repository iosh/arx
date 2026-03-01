export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [k: string]: JsonValue };

// Best-effort JSON-safe conversion for cross-boundary payloads.
// If conversion fails (BigInt, cycles), we omit the field instead of throwing.
export const toJsonSafe = (value: unknown): JsonValue | undefined => {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return undefined;
  }
};

