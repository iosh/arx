import type { ChainRef } from "../../chains/ids.js";
import type { ChainView } from "../../services/runtime/chainViews/types.js";
import type { AccountKey } from "../../storage/records.js";
import type { WalletApiOwnedAccountSummary } from "../../wallet/types.js";
import type { ApprovalDetail, ApprovalListEntry, ApprovalSelectableAccount } from "./models/approvals.js";

export type ChainSnapshot = ChainView;

export type UiOwnedAccountSummary = WalletApiOwnedAccountSummary;

export type UiPermissionChainState = {
  accountKeys: AccountKey[];
};

export type UiPermissionNamespaceState = {
  chains: Record<ChainRef, UiPermissionChainState>;
};

export type UiPermissionsSnapshot = {
  origins: Record<string, Record<string, UiPermissionNamespaceState>>;
};

export type UiKeyringMeta = {
  id: string;
  type: "hd" | "private-key";
  createdAt: number;
  alias?: string | undefined;
  backedUp?: boolean | undefined;
  derivedCount?: number | undefined;
};

export type UiAccountMeta = {
  accountKey: AccountKey;
  canonicalAddress: string;
  keyringId: string;
  derivationIndex?: number | undefined;
  alias?: string | undefined;
  createdAt: number;
  hidden?: boolean | undefined;
};

export type UiBackupKeyringReminder = {
  keyringId: string;
  alias: string | null;
};

export type UiBackupStatus = {
  pendingHdKeyringCount: number;
  nextHdKeyring: UiBackupKeyringReminder | null;
};

export type AttentionRequest = {
  reason: "unlock_required";
  origin: string;
  method: string;
  chainRef: ChainRef | null;
  namespace: string | null;
  requestedAt: number;
  expiresAt: number;
};

export type { ApprovalDetail, ApprovalListEntry, ApprovalSelectableAccount };
