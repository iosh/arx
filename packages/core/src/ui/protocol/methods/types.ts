import type { z } from "zod";

export type UiMethodKind = "query" | "command";

export type UiMethodEffects = {
  broadcastSnapshot?: boolean;
  persistVaultMeta?: boolean;
  holdBroadcast?: boolean;
};

export type UiMethodDefinition = {
  kind: UiMethodKind;
  paramsSchema: z.ZodTypeAny;
  resultSchema: z.ZodTypeAny;
  effects?: UiMethodEffects;
};

export const defineMethod = <P extends z.ZodTypeAny, R extends z.ZodTypeAny>(
  kind: UiMethodKind,
  paramsSchema: P,
  resultSchema: R,
  effects?: UiMethodEffects,
) => ({
  kind,
  paramsSchema,
  resultSchema,
  ...(effects ? { effects } : {}),
});
