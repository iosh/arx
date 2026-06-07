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
  effects?: UiMethodEffects;
};

export const defineMethod = <P extends z.ZodTypeAny>(
  kind: UiMethodKind,
  paramsSchema: P,
  effects?: UiMethodEffects,
) => ({
  kind,
  paramsSchema,
  ...(effects ? { effects } : {}),
});
