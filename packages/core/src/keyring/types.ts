import type { Namespace } from "../namespaces/types.js";

export type KeySourceId = string;
export type HdKeyringId = string;
export type BackupStatus = "pending" | "confirmed";

export type KeySource =
  | Readonly<{
      keySourceId: KeySourceId;
      type: "bip39";
      backupStatus: BackupStatus;
      createdAt: number;
    }>
  | Readonly<{
      keySourceId: KeySourceId;
      type: "private-key";
      namespace: Namespace;
      createdAt: number;
    }>;

export type HdKeyring = Readonly<{
  hdKeyringId: HdKeyringId;
  keySourceId: KeySourceId;
  namespace: Namespace;
  /** Monotonic index reserved for the next HD derivation. */
  nextDerivationIndex: number;
  createdAt: number;
}>;

export type KeyringChanged = Readonly<{
  type: "keyringChanged";
}>;
