import { z } from "zod";
import { defineMethod } from "./types.js";

export const accountsMethods = {
  "ui.accounts.switchActive": defineMethod(
    z.strictObject({
      chainRef: z.string().min(1),
      address: z.string().nullable().optional(),
    }),
    z.string().nullable(),
    { broadcastSnapshot: true },
  ),
} as const;
