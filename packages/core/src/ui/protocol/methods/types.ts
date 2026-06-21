import type { z } from "zod";

export type UiMethodKind = "query" | "command";

export type UiMethodDefinition = {
  kind: UiMethodKind;
  paramsSchema: z.ZodTypeAny;
};

export const defineMethod = <P extends z.ZodTypeAny>(kind: UiMethodKind, paramsSchema: P) => ({
  kind,
  paramsSchema,
});
