import { z } from "zod";
import {
  type ApprovalSelectableAccount,
  ApprovalSelectableAccountSchema,
  type ApprovalSummary,
  ApprovalSummarySchema,
} from "../../approvals/summary.js";
import { ChainRefSchema } from "../../chains/ids.js";
import { AccountKeySchema } from "../../storage/records.js";

export const ChainSnapshotSchema = z.object({
  chainRef: ChainRefSchema,
  chainId: z.string().regex(/^0x[a-fA-F0-9]+$/),
  namespace: z.string().min(1),
  displayName: z.string().min(1),
  shortName: z.string().nullable(),
  icon: z.string().url().nullable(),
  nativeCurrency: z.strictObject({
    name: z.string().min(1),
    symbol: z.string().min(1),
    decimals: z.number().int().nonnegative(),
  }),
});

export const UiOwnedAccountSummarySchema = z.object({
  accountKey: AccountKeySchema,
  canonicalAddress: z.string().min(1),
  displayAddress: z.string().min(1),
});

export const AccountsSnapshotSchema = z.object({
  totalCount: z.number().int().nonnegative(),
  list: z.array(UiOwnedAccountSummarySchema),
  active: UiOwnedAccountSummarySchema.nullable(),
});

export const SessionSnapshotSchema = z.object({
  isUnlocked: z.boolean(),
  autoLockDurationMs: z.number().int().positive(),
  nextAutoLockAt: z.number().int().nullable(),
});

export const UiChainCapabilitiesSchema = z.object({
  nativeBalance: z.boolean(),
  sendTransaction: z.boolean(),
});

export const VaultSnapshotSchema = z.object({
  initialized: z.boolean(),
});

const ChainPermissionStateSchema = z.object({
  accountKeys: z.array(AccountKeySchema),
});

const NamespacePermissionStateSchema = z.object({
  chains: z.record(ChainRefSchema, ChainPermissionStateSchema),
});

const OriginPermissionStateSchema = z.record(z.string().min(1), NamespacePermissionStateSchema);

export const UiPermissionsSnapshotSchema = z.object({
  origins: z.record(z.string().min(1), OriginPermissionStateSchema),
});

export const UiKeyringMetaSchema = z.object({
  id: z.uuid(),
  type: z.enum(["hd", "private-key"]),
  createdAt: z.number().int(),
  alias: z.string().optional(),
  backedUp: z.boolean().optional(),
  derivedCount: z.number().int().nonnegative().optional(),
});

export const UiAccountMetaSchema = z.object({
  accountKey: AccountKeySchema,
  canonicalAddress: z.string(),
  keyringId: z.uuid(),
  derivationIndex: z.number().int().nonnegative().optional(),
  alias: z.string().optional(),
  createdAt: z.number().int(),
  hidden: z.boolean().optional(),
});

export const NetworkListSchema = z.object({
  active: ChainRefSchema,
  known: z.array(ChainSnapshotSchema),
  available: z.array(ChainSnapshotSchema),
});
const HdBackupWarningSchema = z.object({
  keyringId: z.uuid(),
  alias: z.string().nullable(),
});

export const AttentionRequestSchema = z.object({
  reason: z.enum(["unlock_required", "approval_required"]),
  origin: z.string().min(1),
  method: z.string().min(1),
  chainRef: ChainRefSchema.nullable(),
  namespace: z.string().min(1).nullable(),
  requestedAt: z.number().int(),
  expiresAt: z.number().int(),
});

export const UiSnapshotSchema = z.object({
  chain: ChainSnapshotSchema,
  chainCapabilities: UiChainCapabilitiesSchema,
  networks: NetworkListSchema,
  accounts: AccountsSnapshotSchema,
  session: SessionSnapshotSchema,
  approvals: z.array(ApprovalSummarySchema),
  attention: z.object({
    queue: z.array(AttentionRequestSchema),
    count: z.number().int().nonnegative(),
  }),
  permissions: UiPermissionsSnapshotSchema,
  vault: VaultSnapshotSchema,
  warnings: z.object({
    hdKeyringsNeedingBackup: z.array(HdBackupWarningSchema),
  }),
});

export type ChainSnapshot = z.infer<typeof ChainSnapshotSchema>;
export type UiOwnedAccountSummary = z.infer<typeof UiOwnedAccountSummarySchema>;
export type AccountsSnapshot = z.infer<typeof AccountsSnapshotSchema>;
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;
export type UiChainCapabilities = z.infer<typeof UiChainCapabilitiesSchema>;
export type VaultSnapshot = z.infer<typeof VaultSnapshotSchema>;
export type UiSnapshot = z.infer<typeof UiSnapshotSchema>;
export type HdBackupWarning = z.infer<typeof HdBackupWarningSchema>;
export type NetworkListSnapshot = z.infer<typeof NetworkListSchema>;
export type UiKeyringMeta = z.infer<typeof UiKeyringMetaSchema>;
export type UiAccountMeta = z.infer<typeof UiAccountMetaSchema>;
export type UiPermissionsSnapshot = z.infer<typeof UiPermissionsSnapshotSchema>;
export { ApprovalSelectableAccountSchema, ApprovalSummarySchema };
export type { ApprovalSelectableAccount, ApprovalSummary };
