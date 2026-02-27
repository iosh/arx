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
  chainId: z.string().regex(HEX_CHAIN_ID_REGEX, {
    error: "chainId must be a 0x-prefixed hexadecimal value",
  }),
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

const Eip155TransactionRequestInnerSchema = z.strictObject({
  namespace: z.literal("eip155"),
  chainRef: chainRefSchema.optional(),
  payload: Eip155TransactionPayloadSchema,
});

export const GenericTransactionRequestSchema = z
  .strictObject({
    namespace: z.string().min(1),
    chainRef: chainRefSchema.optional(),
    payload: z.record(z.string(), z.unknown()),
  })
  .refine((value) => value.namespace !== "eip155", {
    error: "Use the dedicated eip155 schema for EIP-155 transactions",
    path: ["namespace"],
  });

export const TransactionRequestSchema = z.union([Eip155TransactionRequestInnerSchema, GenericTransactionRequestSchema]);

export const TransactionWarningSchema = z.strictObject({
  kind: z.enum(["warning", "issue"]),
  code: nonEmptyStringSchema,
  message: z.string(),
  severity: z.enum(["low", "medium", "high"]).optional(),
  data: z.unknown().optional(),
});

export const TransactionErrorSchema = z.strictObject({
  name: nonEmptyStringSchema,
  message: z.string(),
  code: z.number().int().optional(),
  data: z.unknown().optional(),
});

export const TransactionReceiptSchema = z.record(z.string(), z.unknown());
