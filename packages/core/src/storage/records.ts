import { z } from "zod";
import { getChainRefNamespace } from "../chains/caip.js";
import { chainMetadataSchema, rpcEndpointSchema } from "../chains/metadata.js";
import { KeyringTypeSchema } from "./keyringSchemas.js";
import {
  RpcStrategySchema,
  TransactionReceiptSchema,
  TransactionReplacementRelationSchema,
  TransactionSubmissionLocatorSchema,
  TransactionSubmittedSchema,
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

export const CustomChainRecordSchema = z
  .strictObject({
    chainRef: chainRefSchema,
    namespace: z.string().min(1),
    metadata: chainMetadataSchema,
    createdByOrigin: originStringSchema.optional(),
    updatedAt: epochMillisecondsSchema,
  })
  .refine((value) => value.metadata.chainRef === value.chainRef, {
    error: "metadata.chainRef must match the record chainRef",
    path: ["metadata", "chainRef"],
  })
  .refine((value) => value.metadata.namespace === value.namespace, {
    error: "metadata.namespace must match the record namespace",
    path: ["metadata", "namespace"],
  });
export type CustomChainRecord = z.infer<typeof CustomChainRecordSchema>;

const validateRpcEndpoints = (
  value: {
    rpcEndpoints: readonly { url: string }[];
  },
  ctx: z.RefinementCtx,
): void => {
  const urls = new Set<string>();
  for (const [index, endpoint] of value.rpcEndpoints.entries()) {
    if (urls.has(endpoint.url)) {
      ctx.addIssue({
        code: "custom",
        message: `rpcEndpoints[${index}] duplicates URL "${endpoint.url}"`,
        path: ["rpcEndpoints", index, "url"],
      });
      continue;
    }
    urls.add(endpoint.url);
  }
};

export const CustomRpcRecordSchema = z
  .strictObject({
    chainRef: chainRefSchema,
    rpcEndpoints: z.array(rpcEndpointSchema).min(1),
    updatedAt: epochMillisecondsSchema,
  })
  .superRefine(validateRpcEndpoints);
export type CustomRpcRecord = z.infer<typeof CustomRpcRecordSchema>;

const ChainRefByNamespaceSchema = z.record(z.string().min(1), chainRefSchema);

export const NetworkSelectionRecordSchema = z
  .strictObject({
    id: z.literal("network-selection"),
    selectedNamespace: z.string().min(1),
    chainRefByNamespace: ChainRefByNamespaceSchema.default({}),
    updatedAt: epochMillisecondsSchema,
  })
  .superRefine((value, ctx) => {
    for (const [namespace, chainRef] of Object.entries(value.chainRefByNamespace)) {
      const chainNamespace = getChainRefNamespace(chainRef);
      if (chainNamespace !== namespace) {
        ctx.addIssue({
          code: "custom",
          message: `chainRefByNamespace[${namespace}] must point to the same namespace`,
          path: ["chainRefByNamespace", namespace],
        });
      }
    }

    const selectedNamespaceChainRef = value.chainRefByNamespace[value.selectedNamespace] ?? null;
    if (!selectedNamespaceChainRef) {
      ctx.addIssue({
        code: "custom",
        message: `chainRefByNamespace must include the selected namespace "${value.selectedNamespace}"`,
        path: ["chainRefByNamespace", value.selectedNamespace],
      });
      return;
    }

    if (getChainRefNamespace(selectedNamespaceChainRef) !== value.selectedNamespace) {
      ctx.addIssue({
        code: "custom",
        message: "selected namespace must resolve to a chain in the same namespace",
        path: ["selectedNamespace"],
      });
    }
  });
export type NetworkSelectionRecord = z.infer<typeof NetworkSelectionRecordSchema>;

const ActiveChainByNamespaceSchema = z.record(z.string().min(1), chainRefSchema);

const NetworkPreferencesRecordInputSchema = z
  .strictObject({
    id: z.literal("network-preferences"),
    selectedNamespace: z.string().min(1),
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

    const selectedNamespaceChainRef = value.activeChainByNamespace[value.selectedNamespace] ?? null;
    if (!selectedNamespaceChainRef) {
      ctx.addIssue({
        code: "custom",
        message: `activeChainByNamespace must include the selected namespace "${value.selectedNamespace}"`,
        path: ["activeChainByNamespace", value.selectedNamespace],
      });
      return;
    }

    if (getChainRefNamespace(selectedNamespaceChainRef) !== value.selectedNamespace) {
      ctx.addIssue({
        code: "custom",
        message: "selected namespace must resolve to a chain in the same namespace",
        path: ["selectedNamespace"],
      });
    }
  });

export const NetworkPreferencesRecordSchema = NetworkPreferencesRecordInputSchema;
export type NetworkPreferencesRecord = z.infer<typeof NetworkPreferencesRecordSchema>;

export const KeyringMetaRecordSchema = z.strictObject({
  id: z.string().uuid(),
  type: KeyringTypeSchema,
  alias: nonEmptyStringSchema.optional(),
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

// Empty means the origin is connected to the chain but has no account access on it.
export const PermissionChainAccountKeysSchema = z.array(AccountKeySchema);
export type PermissionChainAccountKeys = z.infer<typeof PermissionChainAccountKeysSchema>;

export const PermissionChainScopesSchema = z.record(chainRefSchema, PermissionChainAccountKeysSchema);
export type PermissionChainScopes = z.infer<typeof PermissionChainScopesSchema>;

const getAccountKeyNamespace = (accountKey: AccountKey): string | null => {
  const separatorIndex = accountKey.indexOf(":");
  return separatorIndex >= 0 ? accountKey.slice(0, separatorIndex) : null;
};

const validatePermissionRecord = (
  value: {
    namespace: string;
    chainScopes: PermissionChainScopes;
  },
  ctx: z.RefinementCtx,
): void => {
  const chainEntries = Object.entries(value.chainScopes);
  if (chainEntries.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: "chainScopes must not be empty",
      path: ["chainScopes"],
    });
  }

  for (const [chainRef, accountKeys] of chainEntries) {
    const chainNamespace = getChainRefNamespace(chainRef);
    if (chainNamespace !== value.namespace) {
      ctx.addIssue({
        code: "custom",
        message: `chainScopes[${chainRef}] must belong to namespace "${value.namespace}"`,
        path: ["chainScopes", chainRef],
      });
    }

    const uniqueAccounts = new Set(accountKeys);
    if (uniqueAccounts.size !== accountKeys.length) {
      ctx.addIssue({
        code: "custom",
        message: `chainScopes[${chainRef}] must not contain duplicate accountKeys`,
        path: ["chainScopes", chainRef],
      });
    }

    for (const [accountIndex, accountKey] of accountKeys.entries()) {
      if (getAccountKeyNamespace(accountKey) !== value.namespace) {
        ctx.addIssue({
          code: "custom",
          message: `chainScopes[${chainRef}][${accountIndex}] must belong to namespace "${value.namespace}"`,
          path: ["chainScopes", chainRef, accountIndex],
        });
      }
    }
  }
};

export const PermissionRecordSchema = z
  .strictObject({
    origin: originStringSchema,
    namespace: z.string().min(1),
    // One persistent connection-authorization record per (origin, namespace).
    // Request-level signing and transaction approvals remain runtime state.
    chainScopes: PermissionChainScopesSchema,
  })
  .superRefine(validatePermissionRecord);
export type PermissionRecord = z.infer<typeof PermissionRecordSchema>;

export const TransactionStatusSchema = z.enum(["broadcast", "confirmed", "failed", "replaced"]);
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;

export const TransactionRecordSchema = z
  .strictObject({
    id: z.uuid(),
    chainRef: chainRefSchema,
    origin: originStringSchema,
    fromAccountKey: AccountKeySchema,
    status: TransactionStatusSchema,
    submitted: TransactionSubmittedSchema,
    locator: TransactionSubmissionLocatorSchema,
    receipt: TransactionReceiptSchema.optional(),
    replacedById: z.uuid().nullable().optional(),
    createdAt: epochMillisecondsSchema,
    updatedAt: epochMillisecondsSchema,
  })
  .superRefine((value, ctx) => {
    const accountNamespace = value.fromAccountKey.split(":", 1)[0];
    if (accountNamespace !== getChainRefNamespace(value.chainRef)) {
      ctx.addIssue({
        code: "custom",
        message: "fromAccountKey must belong to the same namespace as chainRef",
        path: ["fromAccountKey"],
      });
    }
  });
export type TransactionRecord = z.infer<typeof TransactionRecordSchema>;
