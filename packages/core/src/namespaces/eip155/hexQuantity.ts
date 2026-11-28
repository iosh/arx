import type { Hex } from "ox/Hex";
import { z } from "zod";

export const hexQuantity = z
  .string()
  .regex(/^0x(?:0|[1-9a-f][0-9a-f]*)$/i, "Expected a 0x-prefixed hexadecimal quantity without leading zeros.")
  .transform((value) => value.toLowerCase() as Hex);
