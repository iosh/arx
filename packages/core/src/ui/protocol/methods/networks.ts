import { z } from "zod";
import { ChainRefSchema } from "../../../chains/ids.js";
import { defineMethod } from "./types.js";

export const networksMethods = {
  "ui.networks.switchActive": defineMethod("command", z.strictObject({ chainRef: ChainRefSchema }), {
    broadcastSnapshot: true,
  }),
} as const;
