import type { z } from "zod";

export type UiMethodDefinition = {
  paramsSchema: z.ZodTypeAny;
  resultSchema: z.ZodTypeAny;
  effects?: {
    broadcastSnapshot?: boolean;
    persistVaultMeta?: boolean;
    holdBroadcast?: boolean;
  };
};

export const defineMethod = <P extends z.ZodTypeAny, R extends z.ZodTypeAny>(
  paramsSchema: P,
  resultSchema: R,
  effects?: UiMethodDefinition["effects"],
) => ({
  paramsSchema,
  resultSchema,
  ...(effects ? { effects } : {}),
});
