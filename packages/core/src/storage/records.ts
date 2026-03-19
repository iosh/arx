import { z } from "zod";
import { getChainRefNamespace } from "../chains/caip.js";
import { KeyringTypeSchema } from "./keyringSchemas.js";
import {
  RpcStrategySchema,
  TransactionErrorSchema,
  TransactionIssueSchema,
  TransactionRequestSchema,
  TransactionWarningSchema,
} from "./schemas.js";
import { chainRefSchema, epochMillisecondsSchema, nonEmptyStringSchema, originStringSchema } from "./validators.js";

// Namespace is CAIP-2-ish (e.g. "eip155", "conflux").
// Keep validation loose here; chain-specific rules live in codecs/modules.
export const AccountNamespaceSchema = z.string().min(1);
export type AccountNamespace = z.infer<typeof AccountNamespaceSchema>;

// Deterministic account key: <namespace>:<hex bytes>. Used for dedupe and references.
export const AccountKeySchema = z.string().regex(/^[a-z0-9]+:(?:[0-9a-f]{2})+$/, {
  error: "accountKey must be <namespace>:<even-length lowercase hex bytes>",
});
export type AccountKey = z.infer<typeof AccountKeySchema>;

export const SettingsRecordSchema = z.strictObject({
  id: z.literal("settings"),
  // Per-namespace selection: only store present selections (absence => null).
  selectedAccountKeysByNamespace: z.record(z.string().min(1), AccountKeySchema).optional(),
  updatedAt: epochMillisecondsSchema,
});
export type SettingsRecord = z.infer<typeof SettingsRecordSchema>;

export const NetworkRpcPreferenceSchema = z.strictObject({
  activeIndex: z.number().int().min(0),
  strategy: RpcStrategySchema,
});
export type NetworkRpcPreference = z.infer<typeof NetworkRpcPreferenceSchema>;

const ActiveChainByNamespaceSchema = z.record(z.string().min(1), chainRefSchema);

export const NetworkPreferencesRecordSchema = z
  .strictObject({
    id: z.literal("network-preferences"),
    selectedChainRef: chainRefSchema,
    activeChainByNamespace: ActiveChainByNamespaceSchema.default({}),
    // Preferences only: stable selections (e.g. manual RPC choice), not transient health.
    rpc: z.record(chainRefSchema, NetworkRpcPreferenceSchema).default({}),
    updatedAt: epochMillisecondsSchema,
  })
  .superRefine((value, ctx) => {
    for (const [namespace, chainRef] of Object.entries(value.activeChainByNamespace)) {
      const chainNamespace = getChainRefNamespace(chainRef);
      if (chainNamespace !== namespace) {
        ctx.addIssue({
          code: "custom",
          message: `activeChainByNamespace[${namespace}] must point to the same namespace`,
          path: ["activeChainByNamespace", namespace],
        });
      }
    }
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
    accountKey: AccountKeySchema,
    namespace: AccountNamespaceSchema,
    keyringId: z.string().uuid(),
    derivationIndex: z.number().int().min(0).optional(),
    alias: nonEmptyStringSchema.optional(),
    hidden: z.boolean().optional(),
    createdAt: epochMillisecondsSchema,
  })
  .superRefine((value, ctx) => {
    const separatorIndex = value.accountKey.indexOf(":");
    const accountNamespace = separatorIndex >= 0 ? value.accountKey.slice(0, separatorIndex) : null;
    if (accountNamespace !== value.namespace) {
      ctx.addIssue({
        code: "custom",
        message: `accountKey namespace must equal "${value.namespace}"`,
        path: ["accountKey"],
      });
    }
  });
export type AccountRecord = z.infer<typeof AccountRecordSchema>;

export const PermissionChainScopeSchema = z.strictObject({
  chainRef: chainRefSchema,
  // Empty means the origin is connected to the chain but has no account access on it.
  accountKeys: z.array(AccountKeySchema),
});
export type PermissionChainScope = z.infer<typeof PermissionChainScopeSchema>;

export const PermissionRecordSchema = z
  .strictObject({
    origin: originStringSchema,
    namespace: z.string().min(1),
    // One persistent connection-authorization record per (origin, namespace).
    // Request-level signing and transaction approvals remain runtime state.
    chains: z.array(PermissionChainScopeSchema).min(1),
    updatedAt: epochMillisecondsSchema,
  })
  .superRefine((value, ctx) => {
    const uniqueChains = new Set(value.chains.map((chain) => chain.chainRef));
    if (uniqueChains.size !== value.chains.length) {
      ctx.addIssue({
        code: "custom",
        message: "chains must not contain duplicate chainRef values",
        path: ["chains"],
      });
    }

    for (const [index, chain] of value.chains.entries()) {
      const chainNamespace = getChainRefNamespace(chain.chainRef);
      if (chainNamespace !== value.namespace) {
        ctx.addIssue({
          code: "custom",
          message: `chains[${index}].chainRef must belong to namespace "${value.namespace}"`,
          path: ["chains", index, "chainRef"],
        });
      }

      const uniqueAccounts = new Set(chain.accountKeys);
      if (uniqueAccounts.size !== chain.accountKeys.length) {
        ctx.addIssue({
          code: "custom",
          message: `chains[${index}].accountKeys must not contain duplicates`,
          path: ["chains", index, "accountKeys"],
        });
      }

      for (const [accountIndex, accountKey] of chain.accountKeys.entries()) {
        const separatorIndex = accountKey.indexOf(":");
        const accountNamespace = separatorIndex >= 0 ? accountKey.slice(0, separatorIndex) : null;
        if (accountNamespace !== value.namespace) {
          ctx.addIssue({
            code: "custom",
            message: `chains[${index}].accountKeys[${accountIndex}] must belong to namespace "${value.namespace}"`,
            path: ["chains", index, "accountKeys", accountIndex],
          });
        }
      }
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

export const TransactionRecordSchema = z
  .strictObject({
    id: z.uuid(),
    namespace: z.string().min(1),
    chainRef: chainRefSchema,
    origin: originStringSchema,
    fromAccountKey: AccountKeySchema,
    status: TransactionStatusSchema,
    request: TransactionRequestSchema,
    prepared: z.unknown().nullable().optional(),
    hash: z.string().nullable(),
    receipt: z.unknown().optional(),
    error: TransactionErrorSchema.optional(),
    userRejected: z.boolean(),
    warnings: z.array(TransactionWarningSchema),
    issues: z.array(TransactionIssueSchema),
    createdAt: epochMillisecondsSchema,
    updatedAt: epochMillisecondsSchema,
  })
  .superRefine((value, ctx) => {
    if (value.request.namespace !== value.namespace) {
      ctx.addIssue({
        code: "custom",
        message: `request.namespace must equal record namespace "${value.namespace}"`,
        path: ["request", "namespace"],
      });
    }

    if (value.request.chainRef && value.request.chainRef !== value.chainRef) {
      ctx.addIssue({
        code: "custom",
        message: `request.chainRef must equal record chainRef "${value.chainRef}" when provided`,
        path: ["request", "chainRef"],
      });
    }
  });
export type TransactionRecord = z.infer<typeof TransactionRecordSchema>;
