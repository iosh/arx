import type { KeyringSecrets } from "./secrets.js";

/** Owns decoded key-source secrets for the current unlocked period. */
export class Keyring {
  #secrets: KeyringSecrets | null = null;

  getSecrets(): KeyringSecrets | null {
    return this.#secrets;
  }

  activate(secrets: KeyringSecrets): void {
    this.#secrets = secrets;
  }

  lock(): void {
    this.#secrets = null;
  }
}
