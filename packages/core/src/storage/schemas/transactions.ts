import { z } from "zod";
import {
  accountAddressSchema,
  chainRefSchema,
  hexDataSchema,
  hexQuantitySchema,
  nonEmptyStringSchema,
} from "../validators.js";

const HEX_CHAIN_ID_REGEX = /^0x[0-9a-fA-F]+$/;

export const Eip155TransactionPayloadSchema = z.strictObject({
  chainId: z
    .string()
    .regex(HEX_CHAIN_ID_REGEX, {
      error: "chainId must be a 0x-prefixed hexadecimal value",
    })
    .optional(),
  from: accountAddressSchema.optional(),
  to: accountAddressSchema.optional().nullable(),
  value: hexQuantitySchema.optional(),
  data: hexDataSchema.optional(),
  gas: hexQuantitySchema.optional(),
  gasPrice: hexQuantitySchema.optional(),
  maxFeePerGas: hexQuantitySchema.optional(),
  maxPriorityFeePerGas: hexQuantitySchema.optional(),
  nonce: hexQuantitySchema.optional(),
});

export const Eip155TransactionRequestSchema = z.strictObject({
  namespace: z.literal("eip155"),
  chainRef: chainRefSchema.optional(),
  payload: Eip155TransactionPayloadSchema,
});

export const TransactionPayloadSchema = z.record(z.string(), z.unknown());
export const TransactionPreparedSchema = z.record(z.string(), z.unknown());
export const TransactionReceiptSchema = z.record(z.string(), z.unknown());
export const TransactionSubmittedSchema = z.record(z.string(), z.unknown());
export const TransactionSubmissionLocatorSchema = z.strictObject({
  format: nonEmptyStringSchema,
  value: nonEmptyStringSchema,
});
export const TransactionReplacementRelationSchema = z
  .strictObject({
    transactionId: z.uuid().optional(),
    locator: TransactionSubmissionLocatorSchema.optional(),
  })
  .refine((value) => value.transactionId !== undefined || value.locator !== undefined, {
    error: "replacement relation requires transactionId or locator",
  });

// Persist only the shared transaction envelope here.
// Namespace-specific payload validation belongs at RPC/UI/adapter boundaries.
export const TransactionRequestSchema = z.strictObject({
  namespace: nonEmptyStringSchema,
  chainRef: chainRefSchema.optional(),
  payload: TransactionPayloadSchema,
});

export const TransactionErrorSchema = z.strictObject({
  name: nonEmptyStringSchema,
  message: z.string(),
  code: z.number().int().optional(),
  data: z.unknown().optional(),
});
