import { z } from "zod";
import { ChainRefSchema } from "../../../chains/ids.js";
import { defineMethod } from "./types.js";

export const accountsMethods = {
  "ui.accounts.switchActive": defineMethod(
    z.strictObject({
      chainRef: ChainRefSchema,
      address: z.string().nullable().optional(),
    }),
    z.string().nullable(),
    { broadcastSnapshot: true },
  ),
} as const;
