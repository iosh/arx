export type KeySourceId = string;
export type BackupStatus = "pending" | "confirmed";

export type KeySource =
  | Readonly<{
      keySourceId: KeySourceId;
      type: "bip39";
      /** Local display name shared by this source's accounts. */
      name: string;
      backupStatus: BackupStatus;
      createdAt: number;
    }>
  | Readonly<{
      keySourceId: KeySourceId;
      type: "private-key";
      createdAt: number;
    }>;

export type KeyringChanged = Readonly<{
  type: "keyringChanged";
}>;
