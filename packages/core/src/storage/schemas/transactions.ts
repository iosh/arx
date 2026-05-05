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
export const Eip155PreparedTransactionSchema = z.strictObject({
  from: hexQuantitySchema.optional(),
  to: hexDataSchema.optional().nullable(),
  value: hexQuantitySchema.optional(),
  data: hexDataSchema.optional(),
  gas: hexQuantitySchema.optional(),
  nonce: hexQuantitySchema.optional(),
  chainId: hexQuantitySchema.optional(),
  gasPrice: hexQuantitySchema.optional(),
  maxFeePerGas: hexQuantitySchema.optional(),
  maxPriorityFeePerGas: hexQuantitySchema.optional(),
});

export const Eip155TransactionReceiptSchema = z
  .strictObject({
    status: hexQuantitySchema.optional(),
    transactionHash: hexDataSchema.optional(),
    blockNumber: hexQuantitySchema.optional(),
  })
  .catchall(z.unknown());

export const Eip155SubmittedTransactionSchema = z.strictObject({
  hash: hexDataSchema,
  chainId: hexQuantitySchema,
  from: accountAddressSchema,
  to: accountAddressSchema.optional().nullable(),
  value: hexQuantitySchema.optional(),
  data: hexDataSchema.optional(),
  gas: hexQuantitySchema.optional(),
  nonce: hexQuantitySchema,
  type: hexQuantitySchema.optional().nullable(),
  gasPrice: hexQuantitySchema.optional().nullable(),
  maxFeePerGas: hexQuantitySchema.optional().nullable(),
  maxPriorityFeePerGas: hexQuantitySchema.optional().nullable(),
  accessList: z
    .array(
      z.strictObject({
        address: accountAddressSchema,
        storageKeys: z.array(hexDataSchema),
      }),
    )
    .optional(),
});

export const TransactionPreparedSchema = Eip155PreparedTransactionSchema;
export const TransactionReceiptSchema = Eip155TransactionReceiptSchema;
export const TransactionSubmittedSchema = Eip155SubmittedTransactionSchema;
export const TransactionReplacementRelationSchema = z.strictObject({
  transactionId: z.uuid(),
});

// Persist only the shared transaction envelope here.
// Namespace-specific payload validation belongs at RPC/UI/adapter boundaries.
export const TransactionRequestSchema = z.strictObject({
  namespace: nonEmptyStringSchema,
  chainRef: chainRefSchema,
  payload: TransactionPayloadSchema,
});

export const TransactionErrorSchema = z.strictObject({
  name: nonEmptyStringSchema,
  message: z.string(),
  code: z.number().int().optional(),
  data: z.unknown().optional(),
});
