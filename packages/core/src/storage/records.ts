import { z } from "zod";
import { PERMISSION_SCOPE_VALUES, PermissionScopes } from "../permissions/constants.js";
import { KeyringTypeSchema } from "./keyringSchemas.js";
import {
  chainRefSchema,
  epochMillisecondsSchema,
  nonEmptyStringSchema,
  originStringSchema,
  RpcStrategySchema,
  TransactionErrorSchema,
  TransactionRequestSchema,
  TransactionWarningSchema,
} from "./schemas.js";

// Namespace is CAIP-2-ish (e.g. "eip155", "conflux").
// Keep validation loose here; chain-specific rules live in codecs/modules.
export const AccountNamespaceSchema = z.string().min(1);
export type AccountNamespace = z.infer<typeof AccountNamespaceSchema>;

export const AccountPayloadHexSchema = z.string().regex(/^[0-9a-f]{40}$/, {
  error: "payloadHex must be 40 lowercase hex chars (no 0x)",
});

// Deterministic account key: <namespace>:<hex bytes>. Used for dedupe and references.
export const AccountIdSchema = z.string().regex(/^[a-z0-9]+:(?:[0-9a-f]{2})+$/, {
  error: "accountId must be <namespace>:<even-length lowercase hex bytes>",
});
export type AccountId = z.infer<typeof AccountIdSchema>;

export const SettingsRecordSchema = z.strictObject({
  id: z.literal("settings"),
  // Per-namespace selection: only store present selections (absence => null).
  selectedAccountIdsByNamespace: z.record(z.string().min(1), AccountIdSchema).optional(),
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
    // One entity per (origin, namespace). Each scope carries its own permitted chains.
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
