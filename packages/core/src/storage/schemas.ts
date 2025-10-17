import type { ZodType } from "zod";
import { z } from "zod";
import { chainMetadataSchema } from "../chains/metadata.js";
import { PermissionScopes } from "../controllers/permission/types.js";

const CAIP2_CHAIN_ID_REGEX = /^[a-z0-9]{3,8}:[a-zA-Z0-9-]{1,}$/;
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

const caip2ChainIdSchema = z.string().regex(CAIP2_CHAIN_ID_REGEX, {
  error: "CAIP-2 identifier must follow namespace:reference format",
});

const nativeCurrencySchema = z.strictObject({
  name: nonEmptyStringSchema,
  symbol: nonEmptyStringSchema,
  decimals: z.number().int().min(0),
});

const rpcStatusSchema = z.strictObject({
  endpointIndex: z.number().int().min(0),
  lastError: z.string().optional(),
});

const networkStateSchema = z
  .strictObject({
    activeChain: caip2ChainIdSchema,
    knownChains: z.array(chainMetadataSchema).min(1),
    rpcStatus: z.record(caip2ChainIdSchema, rpcStatusSchema).default({}),
  })
  .refine((value) => value.knownChains.some((chain) => chain.chainRef === value.activeChain), {
    error: "Active chain must appear in knownChains",
    path: ["knownChains"],
  })
  .refine(
    (value) => {
      const ids = value.knownChains.map((chain) => chain.chainRef);
      return new Set(ids).size === ids.length;
    },
    {
      error: "Duplicate CAIP-2 identifiers are not allowed",
      path: ["knownChains"],
    },
  );
const PERMISSION_SCOPE_VALUES = [
  PermissionScopes.Basic,
  PermissionScopes.Accounts,
  PermissionScopes.Sign,
  PermissionScopes.Transaction,
] as const;

const namespaceAccountsStateSchema = z
  .strictObject({
    all: z.array(accountAddressSchema),
    primary: accountAddressSchema.nullable(),
  })
  .refine((value) => !value.primary || value.all.includes(value.primary), {
    error: "Primary account must be included in the all list",
    path: ["primary"],
  });

const activePointerSchema = z
  .strictObject({
    namespace: z.string().min(1),
    chainRef: caip2ChainIdSchema,
    address: accountAddressSchema.nullable(),
  })
  .nullable();

const accountsStateSchema = z
  .strictObject({
    namespaces: z.record(z.string().min(1), namespaceAccountsStateSchema),
    active: activePointerSchema,
  })
  .refine(
    (value) => {
      if (!value.active) return true;
      const namespaceState = value.namespaces[value.active.namespace];
      if (!namespaceState) {
        return false;
      }
      if (!value.active.address) {
        return true;
      }
      return namespaceState.all.includes(value.active.address);
    },
    {
      error: "Active pointer must reference a registered namespace and account",
      path: ["active"],
    },
  );

const permissionScopeSchema = z.enum(PERMISSION_SCOPE_VALUES);

const permissionsStateSchema = z.strictObject({
  origins: z.record(originStringSchema, z.array(permissionScopeSchema)),
});

const approvalStateSchema = z.strictObject({
  pending: z.array(nonEmptyStringSchema),
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
  caip2: caip2ChainIdSchema.optional(),
  payload: eip155TransactionPayloadSchema,
});

const genericTransactionRequestSchema = z
  .strictObject({
    namespace: z.string().min(1),
    caip2: caip2ChainIdSchema.optional(),
    payload: z.record(z.string(), z.unknown()),
  })
  .refine((value) => value.namespace !== "eip155", {
    error: "Use the dedicated eip155 schema for EIP-155 transactions",
    path: ["namespace"],
  });

const transactionRequestSchema = z.union([eip155TransactionRequestSchema, genericTransactionRequestSchema]);

const transactionStatusSchema = z.enum(["pending", "approved", "submitted", "failed"]);

const transactionMetaSchema = z.strictObject({
  id: nonEmptyStringSchema,
  caip2: caip2ChainIdSchema,
  origin: nonEmptyStringSchema,
  from: accountAddressSchema.nullable(),
  request: transactionRequestSchema,
  status: transactionStatusSchema,
  createdAt: epochMillisecondsSchema,
  updatedAt: epochMillisecondsSchema,
});

const transactionStateSchema = z.strictObject({
  pending: z.array(transactionMetaSchema),
  history: z.array(transactionMetaSchema),
});

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
    chainRef: caip2ChainIdSchema,
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

export const StorageNamespaces = {
  Network: "core:network",
  Accounts: "core:accounts",
  Permissions: "core:permissions",
  Approvals: "core:approvals",
  Transactions: "core:transactions",
  VaultMeta: "core:vaultMeta",
} as const;

export type StorageNamespace = (typeof StorageNamespaces)[keyof typeof StorageNamespaces];

export const DOMAIN_SCHEMA_VERSION = 1;
export const NETWORK_SNAPSHOT_VERSION = 1;
export const ACCOUNTS_SNAPSHOT_VERSION = 1;
export const PERMISSIONS_SNAPSHOT_VERSION = 1;
export const APPROVALS_SNAPSHOT_VERSION = 1;
export const TRANSACTIONS_SNAPSHOT_VERSION = 1;
export const CHAIN_REGISTRY_ENTITY_SCHEMA_VERSION = 1;

export const NetworkSnapshotSchema = createSnapshotSchema({
  version: NETWORK_SNAPSHOT_VERSION,
  payload: networkStateSchema,
});
export const AccountsSnapshotSchema = createSnapshotSchema({
  version: ACCOUNTS_SNAPSHOT_VERSION,
  payload: accountsStateSchema,
});
export const PermissionsSnapshotSchema = createSnapshotSchema({
  version: PERMISSIONS_SNAPSHOT_VERSION,
  payload: permissionsStateSchema,
});
export const ApprovalsSnapshotSchema = createSnapshotSchema({
  version: APPROVALS_SNAPSHOT_VERSION,
  payload: approvalStateSchema,
});
export const TransactionsSnapshotSchema = createSnapshotSchema({
  version: TRANSACTIONS_SNAPSHOT_VERSION,
  payload: transactionStateSchema,
});

export type NetworkSnapshot = z.infer<typeof NetworkSnapshotSchema>;
export type AccountsSnapshot = z.infer<typeof AccountsSnapshotSchema>;
export type PermissionsSnapshot = z.infer<typeof PermissionsSnapshotSchema>;
export type ApprovalsSnapshot = z.infer<typeof ApprovalsSnapshotSchema>;
export type TransactionsSnapshot = z.infer<typeof TransactionsSnapshotSchema>;
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

export const StorageSnapshotSchemas = {
  [StorageNamespaces.Network]: NetworkSnapshotSchema,
  [StorageNamespaces.Accounts]: AccountsSnapshotSchema,
  [StorageNamespaces.Permissions]: PermissionsSnapshotSchema,
  [StorageNamespaces.Approvals]: ApprovalsSnapshotSchema,
  [StorageNamespaces.Transactions]: TransactionsSnapshotSchema,
  [StorageNamespaces.VaultMeta]: VaultMetaSnapshotSchema,
} as const satisfies Record<StorageNamespace, ZodType>;

export type StorageSnapshotSchemaMap = typeof StorageSnapshotSchemas;

export type StorageSnapshotMap = {
  [K in keyof StorageSnapshotSchemaMap]: z.infer<StorageSnapshotSchemaMap[K]>;
};

export {
  accountsStateSchema as AccountsStateSchema,
  approvalStateSchema as ApprovalStateSchema,
  eip155TransactionPayloadSchema as Eip155TransactionPayloadSchema,
  genericTransactionRequestSchema as GenericTransactionRequestSchema,
  networkStateSchema as NetworkStateSchema,
  permissionsStateSchema as PermissionsStateSchema,
  transactionMetaSchema as TransactionMetaSchema,
  transactionRequestSchema as TransactionRequestSchema,
  transactionStateSchema as TransactionStateSchema,
  rpcStatusSchema as RpcStatusSchema,
};
