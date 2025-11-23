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
]);

export const UiSnapshotSchema = z.object({
  chain: ChainSnapshotSchema,
  accounts: AccountsSnapshotSchema,
  session: SessionSnapshotSchema,
  approvals: z.array(ApprovalSummarySchema),
  permissions: z.unknown().optional(), // TODO update schema
  vault: VaultSnapshotSchema,
});

export type ChainSnapshot = z.infer<typeof ChainSnapshotSchema>;
export type AccountsSnapshot = z.infer<typeof AccountsSnapshotSchema>;
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;
export type VaultSnapshot = z.infer<typeof VaultSnapshotSchema>;
export type ApprovalSummary = z.infer<typeof ApprovalSummarySchema>;
export type UiSnapshot = z.infer<typeof UiSnapshotSchema>;
