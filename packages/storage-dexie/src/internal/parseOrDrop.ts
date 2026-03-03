type SafeParseResult<T> = { success: true; data: T } | { success: false; error: unknown };

export type SafeParseSchema<T> = {
  safeParse: (value: unknown) => SafeParseResult<T>;
};

export const parseOrDrop = async <T>(params: {
  schema: SafeParseSchema<T>;
  row: unknown;
  what: string;
  drop: () => Promise<unknown>;
  log: { warn: (msg: string, detail?: unknown) => void };
}): Promise<T | null> => {
  const parsed = params.schema.safeParse(params.row);
  if (parsed.success) return parsed.data;

  params.log.warn(`[storage-dexie] invalid ${params.what}, dropping`, parsed.error);
  await params.drop();
  return null;
};
