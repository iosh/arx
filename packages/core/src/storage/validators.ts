import { z } from "zod";
import { CAIP2_CHAIN_REF_PATTERN } from "../chains/caip.js";
import { HTTP_PROTOCOLS, isUrlWithProtocols } from "../chains/url.js";

const HEX_QUANTITY_REGEX = /^0x[0-9a-fA-F]+$/;
const HEX_DATA_REGEX = /^0x[0-9a-fA-F]*$/;

export const epochMillisecondsSchema = z.number().int().min(0);

export const nonEmptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length === value.length, {
    error: "Value must not contain leading or trailing whitespace",
  });

export const originStringSchema = z.string().refine(
  (value) => {
    try {
      const parsed = new URL(value);
      return parsed.origin === value;
    } catch {
      return false;
    }
  },
  {
    error: "Origin must be a valid origin URL",
  },
);

export const accountAddressSchema = z
  .string()
  .min(1)
  .refine((value) => !/\s/.test(value), {
    error: "Account address must not contain whitespace characters",
  });

export const chainRefSchema = z.string().regex(CAIP2_CHAIN_REF_PATTERN, {
  error: "CAIP-2 identifier must follow namespace:reference format",
});

export const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => isUrlWithProtocols(value, HTTP_PROTOCOLS), {
    error: "URL must use http or https protocol",
  });

export const hexQuantitySchema = z.string().regex(HEX_QUANTITY_REGEX, {
  error: "Expected a 0x-prefixed hexadecimal quantity",
});

export const hexDataSchema = z
  .string()
  .regex(HEX_DATA_REGEX, {
    error: "Expected 0x-prefixed even-length hex data",
  })
  // NOTE: regex alone does not enforce even-length. "0x" counts as prefix.
  .refine((value) => (value.length - 2) % 2 === 0, {
    error: "Expected 0x-prefixed even-length hex data",
  });
