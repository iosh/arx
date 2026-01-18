import { z } from "zod";
import { ChainSnapshotSchema } from "../schemas.js";
import { defineMethod } from "./types.js";

export const networksMethods = {
  "ui.networks.switchActive": defineMethod(
    z.strictObject({ chainRef: z.string().min(1) }),
    ChainSnapshotSchema.strict(),
    { broadcastSnapshot: true },
  ),
} as const;
