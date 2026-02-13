import { z } from "zod";

/**
 * Standard "no params" schema for JSON-RPC methods.
 *
 * Accepts either omitted params (undefined) or an empty params array ([]),
 * and (optionally) null for compatibility with some clients,
 * and normalizes the parsed value to `undefined`.
 */
export const NoParamsSchema = z.union([z.undefined(), z.null(), z.tuple([])]).transform(() => undefined);
