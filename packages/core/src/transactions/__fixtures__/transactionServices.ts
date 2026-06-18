import { vi } from "vitest";
import { toAccountKeyFromAddress } from "../../accounts/addressing/accountKey.js";
import { createAccountCodecRegistry, eip155Codec } from "../../accounts/addressing/codec.js";
import { buildEip155ApprovalReview } from "../namespace/eip155/approvalReview.js";
import type { Eip155UnsignedTransaction } from "../namespace/eip155/unsignedTransaction.js";
import type { NamespaceTransaction, SubmittedTransactionInspection } from "../namespace/types.js";

export const APPROVAL_ID = "22222222-2222-4222-8222-222222222222";
export const DEFAULT_CHAIN_REF = "eip155:10";
export const DEFAULT_FROM = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const DEFAULT_TO = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

export const DEFAULT_SUBMITTED = {
  hash: "0xdeadbeef",
  chainId: "0xa",
  from: DEFAULT_FROM,
  to: DEFAULT_TO,
  value: "0x0",
  data: "0x",
  gas: "0x5208",
  nonce: "0x7",
};

export const DEFAULT_UNSIGNED_TRANSACTION: Eip155UnsignedTransaction = {
  type: "legacy",
  chainId: "0xa",
  from: DEFAULT_FROM,
  to: DEFAULT_TO,
  value: "0x0",
  data: "0x",
  gas: "0x5208",
  nonce: "0x7",
  gasPrice: "0x3b9aca00",
};

export const accountCodecs = createAccountCodecRegistry([eip155Codec]);

const pendingSubmittedInspection = {
  chainStatus: "pending",
  evidence: null,
} satisfies SubmittedTransactionInspection;

export const createReceiptTrackingStub = () => ({
  inspectSubmittedTransaction: vi.fn(async () => pendingSubmittedInspection),
});

export const createNamespaceTransactionStub = (
  overrides?: Partial<{
    deriveForChain: (...args: never[]) => unknown;
    validateRequest: (...args: never[]) => unknown;
    prepare: (...args: never[]) => unknown;
    buildReview: (...args: never[]) => unknown;
    applyDraftEdit: (...args: never[]) => unknown;
    deriveApprovalResourceKey: (...args: never[]) => unknown;
    finalizeApproval: (...args: never[]) => unknown;
    deriveConflictKey: (...args: never[]) => unknown;
    createBroadcastArtifact: (...args: never[]) => unknown;
    broadcast: (...args: never[]) => unknown;
    inspectSubmittedTransaction: (...args: never[]) => unknown;
    tracking: unknown;
  }>,
): NamespaceTransaction => ({
  request: {
    ...(overrides?.deriveForChain ? { deriveForChain: overrides.deriveForChain as never } : {}),
    ...(overrides?.validateRequest ? { validateRequest: overrides.validateRequest as never } : {}),
  },
  proposal: {
    prepare:
      (overrides?.prepare as never) ??
      vi.fn(async () => ({
        status: "ready",
        prepared: structuredClone(DEFAULT_UNSIGNED_TRANSACTION),
        reviewSnapshot: structuredClone(DEFAULT_UNSIGNED_TRANSACTION),
      })),
    buildReview: (overrides?.buildReview as never) ?? buildEip155ApprovalReview,
    ...(overrides?.applyDraftEdit ? { applyDraftEdit: overrides.applyDraftEdit as never } : {}),
    ...(overrides?.deriveApprovalResourceKey
      ? { deriveApprovalResourceKey: overrides.deriveApprovalResourceKey as never }
      : {}),
    ...(overrides?.finalizeApproval ? { finalizeApproval: overrides.finalizeApproval as never } : {}),
    ...(overrides?.deriveConflictKey ? { deriveConflictKey: overrides.deriveConflictKey as never } : {}),
  },
  submission: {
    createBroadcastArtifact:
      (overrides?.createBroadcastArtifact as never) ??
      vi.fn(async () => ({
        kind: "eip155.raw_transaction",
        payload: { raw: "0x" },
      })),
    broadcast:
      (overrides?.broadcast as never) ??
      vi.fn(async () => ({
        broadcastIdentity: { hash: DEFAULT_SUBMITTED.hash },
        submitted: DEFAULT_SUBMITTED,
      })),
  },
  ...(overrides?.tracking !== undefined
    ? { tracking: overrides.tracking as never }
    : {
        tracking: {
          ...createReceiptTrackingStub(),
          ...(overrides?.inspectSubmittedTransaction
            ? { inspectSubmittedTransaction: overrides.inspectSubmittedTransaction as never }
            : {}),
        },
      }),
});

export const createDefaultAccountKey = (params?: { chainRef?: string; from?: string }) =>
  toAccountKeyFromAddress({
    chainRef: params?.chainRef ?? DEFAULT_CHAIN_REF,
    address: params?.from ?? DEFAULT_FROM,
    accountCodecs,
  });
