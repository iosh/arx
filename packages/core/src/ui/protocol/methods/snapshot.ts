import { z } from "zod";
import { UiSnapshotSchema } from "../schemas.js";
import { defineMethod } from "./types.js";

export const snapshotMethods = {
  "ui.snapshot.get": defineMethod(z.undefined(), UiSnapshotSchema.strict()),
} as const;
