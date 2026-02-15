import { z } from "zod";
import { chainMetadataSchema } from "../chains/metadata.js";
import {
  chainRefSchema,
  epochMillisecondsSchema,
  nonEmptyStringSchema,
  originStringSchema,
  RpcStrategySchema,
  TransactionErrorSchema,
  TransactionRequestSchema,
  TransactionWarningSchema,
} from "../storage/schemas.js";
import { APPROVAL_TYPE_VALUES, PERMISSION_SCOPE_VALUES, PermissionScopes } from "./constants.js";

export const AccountNamespaceSchema = z.literal("eip155");
export type AccountNamespace = z.infer<typeof AccountNamespaceSchema>;

export const AccountPayloadHexSchema = z.string().regex(/^[0-9a-f]{40}$/, {
  error: "payloadHex must be 40 lowercase hex chars (no 0x)",
});
export const AccountIdSchema = z.string().regex(/^eip155:[0-9a-f]{40}$/, {
  error: "accountId must be eip155:<40 lowercase hex>",
});
export type AccountId = z.infer<typeof AccountIdSchema>;

export const SettingsRecordSchema = z.strictObject({
  id: z.literal("settings"),
  selectedAccountId: AccountIdSchema.optional(),
  updatedAt: epochMillisecondsSchema,
});
export type SettingsRecord = z.infer<typeof SettingsRecordSchema>;

export const NetworkRpcPreferenceSchema = z.strictObject({
  activeIndex: z.number().int().min(0),
  strategy: RpcStrategySchema,
});
export type NetworkRpcPreference = z.infer<typeof NetworkRpcPreferenceSchema>;

export const NetworkPreferencesRecordSchema = z.strictObject({
  id: z.literal("network-preferences"),
  activeChainRef: chainRefSchema,
  // Preferences only: stable selections (e.g. manual RPC choice), not transient health.
  rpc: z.record(chainRefSchema, NetworkRpcPreferenceSchema).default({}),
  updatedAt: epochMillisecondsSchema,
});
export type NetworkPreferencesRecord = z.infer<typeof NetworkPreferencesRecordSchema>;

export const VaultCiphertextSchema = z.strictObject({
  version: z.number().int().positive(),
  algorithm: z.literal("pbkdf2-sha256"),
  salt: z.string().min(1),
  iterations: z.number().int().positive(),
  iv: z.string().min(1),
  cipher: z.string().min(1),
  createdAt: epochMillisecondsSchema,
});
export type VaultCiphertextRecord = z.infer<typeof VaultCiphertextSchema>;

export const UnlockStateRecordSchema = z.strictObject({
  isUnlocked: z.boolean(),
  lastUnlockedAt: epochMillisecondsSchema.nullable(),
  nextAutoLockAt: epochMillisecondsSchema.nullable(),
});
export type UnlockStateRecord = z.infer<typeof UnlockStateRecordSchema>;

export const VaultMetaRecordSchema = z.strictObject({
  id: z.literal("vault-meta"),
  version: z.number().int().positive(),
  updatedAt: epochMillisecondsSchema,
  payload: z.strictObject({
    ciphertext: VaultCiphertextSchema.nullable(),
    autoLockDuration: z.number().int().positive(),
    initializedAt: epochMillisecondsSchema,
    unlockState: UnlockStateRecordSchema.optional(),
  }),
});
export type VaultMetaRecord = z.infer<typeof VaultMetaRecordSchema>;

export const ChainRecordSchema = z
  .strictObject({
    chainRef: chainRefSchema,
    namespace: z.string().min(1),
    metadata: chainMetadataSchema,
    schemaVersion: z.number().int().positive(),
    updatedAt: epochMillisecondsSchema,
  })
  .refine((value) => value.metadata.chainRef === value.chainRef, {
    error: "metadata.chainRef must match chainRef",
    path: ["metadata", "chainRef"],
  })
  .refine((value) => value.metadata.namespace === value.namespace, {
    error: "metadata.namespace must match namespace",
    path: ["metadata", "namespace"],
  });
export type ChainRecord = z.infer<typeof ChainRecordSchema>;

export const KeyringTypeSchema = z.enum(["hd", "private-key"]);
export type KeyringType = z.infer<typeof KeyringTypeSchema>;
export const KeyringMetaRecordSchema = z.strictObject({
  id: z.string().uuid(),
  type: KeyringTypeSchema,
  name: nonEmptyStringSchema.optional(),
  needsBackup: z.boolean().optional(),
  // HD only: the next derivation index to use (monotonic, even if accounts are removed/hidden).
  nextDerivationIndex: z.number().int().min(0).optional(),
  createdAt: epochMillisecondsSchema,
});
export type KeyringMetaRecord = z.infer<typeof KeyringMetaRecordSchema>;

export const AccountRecordSchema = z
  .strictObject({
    accountId: AccountIdSchema,
    namespace: AccountNamespaceSchema,
    payloadHex: AccountPayloadHexSchema,
    keyringId: z.string().uuid(),
    derivationIndex: z.number().int().min(0).optional(),
    alias: nonEmptyStringSchema.optional(),
    hidden: z.boolean().optional(),
    createdAt: epochMillisecondsSchema,
  })
  .superRefine((value, ctx) => {
    const expected = `${value.namespace}:${value.payloadHex}`;
    if (value.accountId !== expected) {
      ctx.addIssue({
        code: "custom",
        message: `accountId must equal "${expected}"`,
        path: ["accountId"],
      });
    }
  });
export type AccountRecord = z.infer<typeof AccountRecordSchema>;

export const PermissionScopeSchema = z.enum(PERMISSION_SCOPE_VALUES);
export type PermissionScope = z.infer<typeof PermissionScopeSchema>;

export const PermissionGrantSchema = z.strictObject({
  scope: PermissionScopeSchema,
  // Chain list where this scope applies (EIP-2255 style caveat).
  chains: z.array(chainRefSchema).min(1),
});
export type PermissionGrantRecord = z.infer<typeof PermissionGrantSchema>;

export const PermissionRecordSchema = z
  .strictObject({
    id: z.string().uuid(),
    origin: originStringSchema,
    namespace: z.string().min(1),
    // One record per (origin, namespace). Each scope carries its own permitted chains.
    grants: z.array(PermissionGrantSchema),
    // EIP-155 only: persisted as AccountIds to stay chain-agnostic.
    accountIds: z.array(AccountIdSchema).min(1).optional(),
    updatedAt: epochMillisecondsSchema,
  })
  .superRefine((value, ctx) => {
    const scopes = value.grants.map((g) => g.scope);
    const uniqueScopes = new Set(scopes);
    if (uniqueScopes.size !== scopes.length) {
      ctx.addIssue({
        code: "custom",
        message: "grants must not contain duplicate scopes",
        path: ["grants"],
      });
    }

    const hasAccountsGrant = scopes.includes(PermissionScopes.Accounts);
    if (hasAccountsGrant && !value.accountIds) {
      ctx.addIssue({
        code: "custom",
        message: "accountIds is required when grants contains Accounts",
        path: ["accountIds"],
      });
    }
    if (!hasAccountsGrant && value.accountIds !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "accountIds must be omitted when grants does not contain Accounts",
        path: ["accountIds"],
      });
    }
  });
export type PermissionRecord = z.infer<typeof PermissionRecordSchema>;

export const ApprovalTypeSchema = z.enum(APPROVAL_TYPE_VALUES);
export type ApprovalType = z.infer<typeof ApprovalTypeSchema>;

export const ApprovalStatusSchema = z.enum(["pending", "approved", "rejected", "expired"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const RequestContextSchema = z.strictObject({
  transport: z.enum(["provider", "ui"]),
  portId: nonEmptyStringSchema,
  sessionId: z.string().uuid(),
  requestId: nonEmptyStringSchema,
  origin: originStringSchema,
});
export type RequestContextRecord = z.infer<typeof RequestContextSchema>;

export const FinalStatusReasonSchema = z.enum([
  "timeout",
  "session_lost",
  "locked",
  "user_reject",
  "user_approve",
  "replaced",
  "internal_error",
]);
export type FinalStatusReason = z.infer<typeof FinalStatusReasonSchema>;

export const ApprovalRecordSchema = z
  .strictObject({
    id: z.string().uuid(),
    type: ApprovalTypeSchema,
    status: ApprovalStatusSchema,
    origin: originStringSchema,
    namespace: z.string().min(1).optional(),
    chainRef: chainRefSchema.optional(),
    payload: z.unknown(),
    result: z.unknown().optional(),
    requestContext: RequestContextSchema,
    expiresAt: epochMillisecondsSchema,
    createdAt: epochMillisecondsSchema,
    finalizedAt: epochMillisecondsSchema.optional(),
    finalStatusReason: FinalStatusReasonSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const isPending = value.status === "pending";
    const hasFinalizedAt = value.finalizedAt !== undefined;
    const hasReason = value.finalStatusReason !== undefined;

    if (isPending) {
      if (hasFinalizedAt) {
        ctx.addIssue({
          code: "custom",
          message: "finalizedAt must be omitted when status is pending",
          path: ["finalizedAt"],
        });
      }
      if (hasReason) {
        ctx.addIssue({
          code: "custom",
          message: "finalStatusReason must be omitted when status is pending",
          path: ["finalStatusReason"],
        });
      }
      return;
    }

    if (!hasFinalizedAt) {
      ctx.addIssue({
        code: "custom",
        message: "finalizedAt is required when status is not pending",
        path: ["finalizedAt"],
      });
    }
    if (!hasReason) {
      ctx.addIssue({
        code: "custom",
        message: "finalStatusReason is required when status is not pending",
        path: ["finalStatusReason"],
      });
    }
  });
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;

export const TransactionStatusSchema = z.enum([
  "pending",
  "approved",
  "signed",
  "broadcast",
  "confirmed",
  "failed",
  "replaced",
]);
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;

export const TransactionRecordSchema = z.strictObject({
  id: z.string().uuid(),
  namespace: z.string().min(1),
  chainRef: chainRefSchema,
  origin: originStringSchema,
  fromAccountId: AccountIdSchema,
  status: TransactionStatusSchema,
  request: TransactionRequestSchema,
  prepared: z.unknown().nullable().optional(),
  hash: z.string().nullable(),
  receipt: z.unknown().optional(),
  error: TransactionErrorSchema.optional(),
  userRejected: z.boolean(),
  warnings: z.array(TransactionWarningSchema),
  issues: z.array(TransactionWarningSchema),
  createdAt: epochMillisecondsSchema,
  updatedAt: epochMillisecondsSchema,
});
export type TransactionRecord = z.infer<typeof TransactionRecordSchema>;
