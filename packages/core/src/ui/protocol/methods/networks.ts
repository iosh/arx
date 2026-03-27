import { z } from "zod";
import { ChainRefSchema } from "../../../chains/ids.js";
import { ChainSnapshotSchema } from "../schemas.js";
import { defineMethod } from "./types.js";

export const networksMethods = {
  "ui.networks.switchActive": defineMethod(
    "command",
    z.strictObject({ chainRef: ChainRefSchema }),
    ChainSnapshotSchema.strict(),
    {
      broadcastSnapshot: true,
    },
  ),
} as const;
