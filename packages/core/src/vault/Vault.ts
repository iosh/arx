import type { UnlockedVault } from "./crypto.js";
import { VaultLockedError, VaultNotInitializedError } from "./errors.js";
import type { EncryptedVaultRecord } from "./persistence.js";

export type VaultStatus = "uninitialized" | "locked" | "unlocked";

type VaultState =
  | Readonly<{ status: "uninitialized" }>
  | Readonly<{ status: "locked"; record: EncryptedVaultRecord }>
  | Readonly<{ status: "unlocked"; unlocked: UnlockedVault }>;

/** Owns the encrypted vault and sensitive material for the current unlocked period. */
export class Vault {
  #state: VaultState;

  constructor(record: EncryptedVaultRecord | null) {
    this.#state = record ? { status: "locked", record } : { status: "uninitialized" };
  }

  getStatus(): VaultStatus {
    return this.#state.status;
  }

  requireRecord(): EncryptedVaultRecord {
    if (this.#state.status === "uninitialized") throw new VaultNotInitializedError();
    return this.#state.status === "locked" ? this.#state.record : this.#state.unlocked.record;
  }

  requireUnlocked(): UnlockedVault {
    if (this.#state.status !== "unlocked") throw new VaultLockedError();
    return this.#state.unlocked;
  }

  activate(unlocked: UnlockedVault): void {
    this.#state = { status: "unlocked", unlocked };
  }

  lock(): void {
    if (this.#state.status !== "unlocked") return;
    this.#state = { status: "locked", record: this.#state.unlocked.record };
  }

  activateDeleted(): void {
    this.#state = { status: "uninitialized" };
  }
}
