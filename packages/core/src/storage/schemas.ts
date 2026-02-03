import type { ZodType } from "zod";
import { z } from "zod";
import { chainMetadataSchema } from "../chains/metadata.js";
import { HTTP_PROTOCOLS, isUrlWithProtocols } from "../chains/url.js";

const CHAIN_REF_REGEX = /^[a-z0-9]{3,8}:[a-zA-Z0-9-]{1,}$/;
const HEX_CHAIN_ID_REGEX = /^0x[0-9a-fA-F]+$/;
const HEX_QUANTITY_REGEX = /^0x[0-9a-fA-F]+$/;
const HEX_DATA_REGEX = /^0x[0-9a-fA-F]*$/;

const epochMillisecondsSchema = z.number().int().min(0);

const nonEmptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length === value.length, {
    error: "Value must not contain leading or trailing whitespace",
  });

const originStringSchema = z.string().refine(
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

const accountAddressSchema = z
  .string()
  .min(1)
  .refine((value) => !/\s/.test(value), {
    error: "Account address must not contain whitespace characters",
  });

const chainRefSchema = z.string().regex(CHAIN_REF_REGEX, {
  error: "CAIP-2 identifier must follow namespace:reference format",
});

const nativeCurrencySchema = z.strictObject({
  name: nonEmptyStringSchema,
  symbol: nonEmptyStringSchema,
  decimals: z.number().int().min(0),
});
const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => isUrlWithProtocols(value, HTTP_PROTOCOLS), {
    error: "URL must use http or https protocol",
  });

const rpcEndpointInfoSchema = z.strictObject({
  index: z.number().int().min(0),
  url: httpUrlSchema,
  type: z.enum(["public", "authenticated", "private"]).optional(),
  weight: z.number().positive().optional(),
  headers: z.record(nonEmptyStringSchema, z.string()).optional(),
});

const rpcErrorSnapshotSchema = z.strictObject({
  message: nonEmptyStringSchema,
  code: z.union([z.number(), z.string()]).optional(),
  data: z.unknown().optional(),
  capturedAt: epochMillisecondsSchema,
});

const rpcEndpointHealthSchema = z.strictObject({
  index: z.number().int().min(0),
  successCount: z.number().int().min(0),
  failureCount: z.number().int().min(0),
  consecutiveFailures: z.number().int().min(0),
  lastError: rpcErrorSnapshotSchema.optional(),
  lastFailureAt: epochMillisecondsSchema.optional(),
  cooldownUntil: epochMillisecondsSchema.optional(),
});

const rpcStrategySchema = z.strictObject({
  id: nonEmptyStringSchema,
  options: z.record(z.string(), z.unknown()).optional(),
});

const rpcEndpointStateSchema = z
  .strictObject({
    activeIndex: z.number().int().min(0),
    endpoints: z.array(rpcEndpointInfoSchema).min(1),
    health: z.array(rpcEndpointHealthSchema),
    strategy: rpcStrategySchema,
    lastUpdatedAt: epochMillisecondsSchema,
  })
  .refine((value) => value.health.length === value.endpoints.length, {
    error: "Health list must match endpoint list",
    path: ["health"],
  })
  .refine((value) => value.activeIndex < value.endpoints.length, {
    error: "activeIndex must reference a declared endpoint",
    path: ["activeIndex"],
  });

const hexQuantitySchema = z.string().regex(HEX_QUANTITY_REGEX, {
  error: "Expected a 0x-prefixed hexadecimal quantity",
});

const hexDataSchema = z.string().regex(HEX_DATA_REGEX, {
  error: "Expected 0x-prefixed even-length hex data",
});

const eip155TransactionPayloadSchema = z.strictObject({
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

const eip155TransactionRequestSchema = z.strictObject({
  namespace: z.literal("eip155"),
  chainRef: chainRefSchema.optional(),
  payload: eip155TransactionPayloadSchema,
});

const genericTransactionRequestSchema = z
  .strictObject({
    namespace: z.string().min(1),
    chainRef: chainRefSchema.optional(),
    payload: z.record(z.string(), z.unknown()),
  })
  .refine((value) => value.namespace !== "eip155", {
    error: "Use the dedicated eip155 schema for EIP-155 transactions",
    path: ["namespace"],
  });

const transactionRequestSchema = z.union([eip155TransactionRequestSchema, genericTransactionRequestSchema]);

const transactionWarningSchema = z.strictObject({
  kind: z.enum(["warning", "issue"]),
  code: nonEmptyStringSchema,
  message: z.string(),
  severity: z.enum(["low", "medium", "high"]).optional(),
  data: z.unknown().optional(),
});

const transactionErrorSchema = z.strictObject({
  name: nonEmptyStringSchema,
  message: z.string(),
  code: z.number().int().optional(),
  data: z.unknown().optional(),
});

const transactionReceiptSchema = z.record(z.string(), z.unknown());

const createSnapshotSchema = <TPayload extends ZodType, TVersion extends number>(config: {
  version: TVersion;
  payload: TPayload;
}) =>
  z.strictObject({
    version: z.literal(config.version),
    updatedAt: epochMillisecondsSchema,
    payload: config.payload,
  });

const chainRegistryEntitySchema = z
  .strictObject({
    chainRef: chainRefSchema,
    namespace: z.string().min(1),
    metadata: chainMetadataSchema,
    schemaVersion: z.number().int().positive(),
    updatedAt: epochMillisecondsSchema,
  })
  .refine((value) => value.metadata.chainRef === value.chainRef, {
    error: "metadata.chainRef must match the entity chainRef",
    path: ["metadata", "chainRef"],
  })
  .refine((value) => value.metadata.namespace === value.namespace, {
    error: "metadata.namespace must match the entity namespace",
    path: ["metadata", "namespace"],
  });

export const DOMAIN_SCHEMA_VERSION = 1;
export const CHAIN_REGISTRY_ENTITY_SCHEMA_VERSION = 1;
export const ChainRegistryEntitySchema = chainRegistryEntitySchema;
export type ChainRegistryEntity = z.infer<typeof ChainRegistryEntitySchema>;

const vaultCiphertextSchema = z
  .strictObject({
    version: z.number().int().positive(),
    algorithm: z.literal("pbkdf2-sha256"),
    salt: z.string().min(1),
    iterations: z.number().int().positive(),
    iv: z.string().min(1),
    cipher: z.string().min(1),
    createdAt: epochMillisecondsSchema,
  })
  .optional();
export const VAULT_META_SNAPSHOT_VERSION = 1;

const unlockStateSnapshotSchema = z.strictObject({
  isUnlocked: z.boolean(),
  lastUnlockedAt: epochMillisecondsSchema.nullable(),
  nextAutoLockAt: epochMillisecondsSchema.nullable(),
});

export const VaultMetaSnapshotSchema = createSnapshotSchema({
  version: VAULT_META_SNAPSHOT_VERSION,
  payload: z.strictObject({
    ciphertext: vaultCiphertextSchema.nullable(),
    autoLockDuration: z.number().int().positive(),
    initializedAt: epochMillisecondsSchema,
    unlockState: unlockStateSnapshotSchema.optional(),
  }),
});

export type VaultMetaSnapshot = z.infer<typeof VaultMetaSnapshotSchema>;

export {
  eip155TransactionPayloadSchema as Eip155TransactionPayloadSchema,
  genericTransactionRequestSchema as GenericTransactionRequestSchema,
  transactionRequestSchema as TransactionRequestSchema,
  rpcEndpointInfoSchema as RpcEndpointInfoSchema,
  rpcEndpointHealthSchema as RpcEndpointHealthSchema,
  rpcEndpointStateSchema as RpcEndpointStateSchema,
  rpcStrategySchema as RpcStrategySchema,
  rpcErrorSnapshotSchema as RpcErrorSnapshotSchema,
  transactionWarningSchema as TransactionWarningSchema,
  transactionErrorSchema as TransactionErrorSchema,
  transactionReceiptSchema as TransactionReceiptSchema,
  accountAddressSchema,
  chainRefSchema,
  epochMillisecondsSchema,
  hexDataSchema,
  hexQuantitySchema,
  nonEmptyStringSchema,
  originStringSchema,
};
