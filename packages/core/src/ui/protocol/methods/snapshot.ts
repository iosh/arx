import { z } from "zod";
import { defineMethod } from "./types.js";

export const snapshotMethods = {
  "ui.snapshot.get": defineMethod("query", z.undefined()),
} as const;
