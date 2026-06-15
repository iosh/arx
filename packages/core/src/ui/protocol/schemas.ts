import type { ChainRef } from "../../chains/ids.js";
import type { AccountKey } from "../../storage/records.js";
import type { ApprovalDetail, ApprovalListEntry, ApprovalSelectableAccount } from "./models/approvals.js";

export type ChainSnapshot = {
  chainRef: ChainRef;
  namespace: string;
  displayName: string;
  shortName: string | null;
  icon: string | null;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
};

export type UiOwnedAccountSummary = {
  accountKey: AccountKey;
  canonicalAddress: string;
  displayAddress: string;
};

export type AccountsSnapshot = {
  totalCount: number;
  list: UiOwnedAccountSummary[];
  active: UiOwnedAccountSummary | null;
};

export type SessionSnapshot = {
  isUnlocked: boolean;
  autoLockDurationMs: number;
  nextAutoLockAt: number | null;
};

export type UiChainCapabilities = {
  nativeBalance: boolean;
  sendTransaction: boolean;
};

export type VaultSnapshot = {
  initialized: boolean;
};

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

export type NetworkListSnapshot = {
  selectedNamespace: string;
  active: ChainRef;
  known: ChainSnapshot[];
  available: ChainSnapshot[];
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

export type UiSnapshot = {
  chain: ChainSnapshot;
  chainCapabilities: UiChainCapabilities;
  networks: NetworkListSnapshot;
  accounts: AccountsSnapshot;
  session: SessionSnapshot;
  attention: {
    queue: AttentionRequest[];
    count: number;
  };
  permissions: UiPermissionsSnapshot;
  backup: UiBackupStatus;
  vault: VaultSnapshot;
};

export type { ApprovalDetail, ApprovalListEntry, ApprovalSelectableAccount };
