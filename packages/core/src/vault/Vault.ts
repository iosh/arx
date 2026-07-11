import type { UnlockedVault } from "./crypto.js";
import { VaultLockedError, VaultNotInitializedError } from "./errors.js";
import type { EncryptedVaultRecord } from "./persistence.js";

export type VaultStatus = "uninitialized" | "locked" | "unlocked";

/** Owns the encrypted vault and sensitive material for the current unlocked period. */
export class Vault {
  #record: EncryptedVaultRecord | null;
  #unlocked: UnlockedVault | null = null;

  constructor(record: EncryptedVaultRecord | null) {
    this.#record = record;
  }

  getStatus(): VaultStatus {
    if (this.#unlocked) return "unlocked";
    return this.#record ? "locked" : "uninitialized";
  }

  getRecord(): EncryptedVaultRecord | null {
    return this.#record;
  }

  requireRecord(): EncryptedVaultRecord {
    if (!this.#record) throw new VaultNotInitializedError();
    return this.#record;
  }

  requireUnlocked(): UnlockedVault {
    if (!this.#unlocked) throw new VaultLockedError();
    return this.#unlocked;
  }

  activate(unlocked: UnlockedVault): void {
    this.#record = unlocked.record;
    this.#unlocked = unlocked;
  }

  lock(): boolean {
    if (!this.#unlocked) return false;
    this.#unlocked = null;
    return true;
  }

  clear(): void {
    this.#unlocked = null;
    this.#record = null;
  }
}
