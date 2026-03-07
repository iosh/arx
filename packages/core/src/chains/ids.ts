import { z } from "zod";
import { CAIP2_CHAIN_REF_PATTERN } from "./caip.js";

export type ChainRef = string;

export const ChainRefSchema = z.string().regex(CAIP2_CHAIN_REF_PATTERN, {
  message: "Invalid CAIP-2 chainRef",
});
