import { z } from "zod";

export const ChainSnapshotSchema = z.object({
  chainRef: z.string().min(1),
  chainId: z.string().regex(/^0x[a-fA-F0-9]+$/),
  namespace: z.string().min(1),
  displayName: z.string().min(1),
  shortName: z.string().nullable(),
  icon: z.string().url().nullable(),
});

export const AccountsSnapshotSchema = z.object({
  totalCount: z.number().int().nonnegative(),
  list: z.array(z.string()),
  active: z.string().nullable(),
});

export const SessionSnapshotSchema = z.object({
  isUnlocked: z.boolean(),
  autoLockDurationMs: z.number().int().nonnegative(),
  nextAutoLockAt: z.number().int().nullable(),
});

export const VaultSnapshotSchema = z.object({
  initialized: z.boolean(),
});

const PermissionScopeSchema = z.enum([
  "wallet_basic",
  "wallet_accounts",
  "wallet_sign",
  "wallet_transaction",
]);

const NamespacePermissionStateSchema = z.object({
  scopes: z.array(PermissionScopeSchema),
  chains: z.array(z.string().min(1)),
  accountsByChain: z.record(z.string().min(1), z.array(z.string().min(1))).optional(),
});

const OriginPermissionStateSchema = z.record(z.string().min(1), NamespacePermissionStateSchema);

const PermissionsStateSchema = z.object({
  origins: z.record(z.string().min(1), OriginPermissionStateSchema),
});

const approvalPayloadBase = z.object({
  id: z.string(),
  origin: z.string(),
  namespace: z.string(),
  chainRef: z.string(),
  createdAt: z.number().int(),
});
export const ApprovalSummarySchema = z.discriminatedUnion("type", [
  approvalPayloadBase.extend({
    type: z.literal("requestAccounts"),
    payload: z.object({ suggestedAccounts: z.array(z.string()) }),
  }),
  approvalPayloadBase.extend({
    type: z.literal("signMessage"),
    payload: z.object({ from: z.string(), message: z.string() }),
  }),
  approvalPayloadBase.extend({
    type: z.literal("signTypedData"),
    payload: z.object({ from: z.string(), typedData: z.string() }),
  }),
  approvalPayloadBase.extend({
    type: z.literal("sendTransaction"),
    payload: z.object({
      from: z.string(),
      to: z.string().nullable(),
      value: z.string().optional(),
      data: z.string().optional(),
      gas: z.string().optional(),
      fee: z
        .object({
          gasPrice: z.string().optional(),
          maxFeePerGas: z.string().optional(),
          maxPriorityFeePerGas: z.string().optional(),
        })
        .optional(),
      summary: z.record(z.string(), z.unknown()).optional(),
      warnings: z
        .array(
          z.object({
            code: z.string(),
            message: z.string(),
            level: z.enum(["info", "warning", "error"]).optional(),
            details: z.record(z.string(), z.unknown()).optional(),
          }),
        )
        .optional(),
      issues: z
        .array(
          z.object({
            code: z.string(),
            message: z.string(),
            severity: z.enum(["low", "medium", "high"]).optional(),
            details: z.record(z.string(), z.unknown()).optional(),
          }),
        )
        .optional(),
    }),
  }),
  approvalPayloadBase.extend({
    type: z.literal("requestPermissions"),
    payload: z.object({
      permissions: z.array(
        z.object({
          capability: z.string(),
          scope: z.string(),
          chains: z.array(z.string()),
        }),
      ),
    }),
  }),
]);

export const UiKeyringMetaSchema = z.object({
  id: z.uuid(),
  type: z.enum(["hd", "private-key"]),
  createdAt: z.number().int(),
  alias: z.string().optional(),
  backedUp: z.boolean().optional(),
  derivedCount: z.number().int().nonnegative().optional(),
});

export const UiAccountMetaSchema = z.object({
  address: z.string(),
  keyringId: z.uuid(),
  derivationIndex: z.number().int().nonnegative().optional(),
  alias: z.string().optional(),
  createdAt: z.number().int(),
  hidden: z.boolean().optional(),
});

export const NetworkListSchema = z.object({
  active: z.string().min(1),
  known: z.array(ChainSnapshotSchema),
});
const HdBackupWarningSchema = z.object({
  keyringId: z.uuid(),
  alias: z.string().nullable(),
});

export const AttentionRequestSchema = z.object({
  reason: z.enum(["unlock_required", "approval_required"]),
  origin: z.string().min(1),
  method: z.string().min(1),
  chainRef: z.string().min(1).nullable(),
  namespace: z.string().min(1).nullable(),
  requestedAt: z.number().int(),
  expiresAt: z.number().int(),
});

export const UiSnapshotSchema = z.object({
  chain: ChainSnapshotSchema,
  networks: NetworkListSchema,
  accounts: AccountsSnapshotSchema,
  session: SessionSnapshotSchema,
  approvals: z.array(ApprovalSummarySchema),
  attention: z.object({
    queue: z.array(AttentionRequestSchema),
    count: z.number().int().nonnegative(),
  }),
  permissions: PermissionsStateSchema,
  vault: VaultSnapshotSchema,
  warnings: z.object({
    hdKeyringsNeedingBackup: z.array(HdBackupWarningSchema),
  }),
});

export type ChainSnapshot = z.infer<typeof ChainSnapshotSchema>;
export type AccountsSnapshot = z.infer<typeof AccountsSnapshotSchema>;
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;
export type VaultSnapshot = z.infer<typeof VaultSnapshotSchema>;
export type ApprovalSummary = z.infer<typeof ApprovalSummarySchema>;
export type UiSnapshot = z.infer<typeof UiSnapshotSchema>;
export type HdBackupWarning = z.infer<typeof HdBackupWarningSchema>;
export type NetworkListSnapshot = z.infer<typeof NetworkListSchema>;
export type UiKeyringMeta = z.infer<typeof UiKeyringMetaSchema>;
export type UiAccountMeta = z.infer<typeof UiAccountMetaSchema>;
