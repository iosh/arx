import type { UnlockLockedPayload, UnlockUnlockedPayload } from "../../controllers/unlock/types.js";
import { keyringErrors } from "../../errors/keyring.js";
import type { HierarchicalDeterministicKeyring, SimpleKeyring } from "../../keyring/types.js";
import { decodePayload } from "./keyring-utils.js";
import type { AccountMeta, KeyringMeta, KeyringServiceOptions, Payload, RuntimeKeyring } from "./types.js";

// State container passed from KeyringService
type KeyringState = {
  keyrings: Map<string, RuntimeKeyring>;
  keyringMetas: Map<string, KeyringMeta>;
  accountMetas: Map<string, AccountMeta>;
};

// Manages keyring lifecycle: hydration on unlock, cleanup on lock
export class KeyringHydration {
  #options: KeyringServiceOptions;
  #state: KeyringState;
  #onHydrated: (payload: Payload | null) => void;
  #subscriptions: Array<() => void> = [];
  #initializing = false;
  #hydrationPromise: Promise<void> | null = null;

  constructor(options: KeyringServiceOptions, state: KeyringState, onHydrated: (payload: Payload | null) => void) {
    this.#options = options;
    this.#state = state;
    this.#onHydrated = onHydrated;
  }

  // Subscribe to unlock events
  async attach() {
    if (this.#subscriptions.length > 0) return;
    this.#subscriptions.push(this.#options.unlock.onUnlocked((payload) => this.#handleUnlocked(payload)));
    this.#subscriptions.push(this.#options.unlock.onLocked((payload) => this.#handleLocked(payload)));
    if (this.#options.unlock.isUnlocked()) {
      await this.#hydrate();
    }
  }

  // Unsubscribe and clear runtime state
  detach() {
    this.#subscriptions.splice(0).forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (error) {
        this.#options.logger?.("keyring: failed to remove unlock subscription", error);
      }
    });
    this.#subscriptions = [];
    this.clear();
    this.#onHydrated(null);
  }

  // Wait for hydration to complete (with timeout)
  async waitForHydration(): Promise<void> {
    const hydration = this.#hydrationPromise;
    if (!this.#initializing || !hydration) return;

    const timeoutMs = 10_000;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        hydration,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Hydration timeout")), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  // Clear runtime keyrings and state
  clear() {
    for (const runtime of this.#state.keyrings.values()) {
      try {
        runtime.instance.clear();
      } catch (error) {
        this.#options.logger?.("keyring: failed to clear runtime keyring", error);
      }
    }
    this.#state.keyrings.clear();
    this.#state.keyringMetas.clear();
    this.#state.accountMetas.clear();
  }

  // Load keyrings from vault on unlock
  async #hydrate() {
    if (this.#initializing) return;
    this.#initializing = true;

    let resolveHydration!: () => void;
    this.#hydrationPromise = new Promise<void>((resolve) => {
      resolveHydration = resolve;
    });

    try {
      if (!this.#options.vault.isUnlocked()) {
        this.clear();
        this.#onHydrated(null);
        return;
      }

      const [metas, accounts] = await Promise.all([
        this.#options.keyringStore.getKeyringMetas(),
        this.#options.keyringStore.getAccountMetas(),
      ]);

      // Update state maps
      this.#state.keyringMetas.clear();
      for (const m of metas) {
        this.#state.keyringMetas.set(m.id, m);
      }

      this.#state.accountMetas.clear();
      for (const a of accounts) {
        this.#state.accountMetas.set(a.address, a);
      }

      // Decode payload from vault
      const payload = decodePayload(this.#options.vault.exportKey(), this.#options.logger);
      this.#state.keyrings.clear();

      const defaultNamespace = this.#getDefaultNamespace();

      // Restore keyring instances from payload
      for (const entry of payload.keyrings) {
        const namespace = entry.namespace ?? defaultNamespace;
        const config = this.#getNamespaceConfig(namespace);
        const factory =
          entry.type === "hd"
            ? config.factories.hd
            : entry.type === "private-key"
              ? config.factories["private-key"]
              : undefined;
        if (!factory) continue;

        try {
          const instance = factory();
          if (entry.type === "hd") {
            const hdPayload = entry.payload as { mnemonic?: string[]; passphrase?: string };
            if (!Array.isArray(hdPayload.mnemonic)) throw keyringErrors.secretUnavailable();
            const hd = instance as HierarchicalDeterministicKeyring;
            hd.loadFromMnemonic(
              hdPayload.mnemonic.join(" "),
              hdPayload.passphrase ? { passphrase: hdPayload.passphrase } : undefined,
            );

            // Verify derived accounts match stored metadata
            const accs = accounts.filter((a) => a.keyringId === entry.keyringId);
            const derived = accs
              .filter((a) => a.derivationIndex !== undefined)
              .sort((a, b) => (a.derivationIndex ?? 0) - (b.derivationIndex ?? 0));

            for (const meta of derived) {
              const derivedAccount = hd.deriveAccount(meta.derivationIndex ?? 0);
              if (config.normalizeAddress(derivedAccount.address) !== meta.address) {
                throw keyringErrors.secretUnavailable();
              }
            }
          } else {
            const pkPayload = entry.payload as { privateKey?: string };
            if (typeof pkPayload.privateKey !== "string") throw keyringErrors.secretUnavailable();
            const simple = instance as SimpleKeyring;
            simple.loadFromPrivateKey(pkPayload.privateKey);
          }

          this.#state.keyrings.set(entry.keyringId, { id: entry.keyringId, kind: entry.type, namespace, instance });
        } catch (error) {
          this.#options.logger?.(`keyring: failed to hydrate keyring ${entry.keyringId}`, error);
        }
      }

      await this.#reconcileDerivedCounts();
      this.#onHydrated(payload);
    } finally {
      this.#initializing = false;
      resolveHydration();
      this.#hydrationPromise = null;
    }
  }

  // Reconcile HD keyring derivedCount with stored accounts
  async #reconcileDerivedCounts() {
    let patched = false;

    for (const [keyringId, meta] of this.#state.keyringMetas) {
      if (meta.type !== "hd") continue;
      const accounts = Array.from(this.#state.accountMetas.values()).filter((a) => a.keyringId === keyringId);
      const maxIndex = Math.max(-1, ...accounts.map((a) => a.derivationIndex ?? -1));
      const expected = maxIndex + 1;
      if (meta.derivedCount === undefined || meta.derivedCount < expected) {
        this.#options.logger?.(`keyring: derivedCount mismatch, fixing ${meta.derivedCount ?? "unset"} -> ${expected}`);
        this.#state.keyringMetas.set(keyringId, { ...meta, derivedCount: expected });
        patched = true;
      }
    }

    if (patched) {
      await this.#options.keyringStore.putKeyringMetas(Array.from(this.#state.keyringMetas.values()));
    }
  }

  #handleUnlocked(_payload: UnlockUnlockedPayload): void {
    void this.#hydrate().catch((error) => this.#options.logger?.("keyring: hydrate failed", error));
  }

  #handleLocked(_payload: UnlockLockedPayload): void {
    this.clear();
    this.#onHydrated(null);
  }

  #getDefaultNamespace(): string {
    const [first] = this.#options.namespaces;
    if (!first) throw new Error("No keyring namespace configured");
    return first.namespace;
  }

  #getNamespaceConfig(namespace: string) {
    const config = this.#options.namespaces.find((ns) => ns.namespace === namespace);
    if (!config) throw new Error(`Namespace "${namespace}" is not supported`);
    return config;
  }
}
