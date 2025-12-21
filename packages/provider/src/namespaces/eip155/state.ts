import type { TransportMeta } from "../../types/transport.js";
import { cloneTransportMeta } from "../../utils/transportMeta.js";
import { DEFAULT_NAMESPACE } from "./constants.js";

export type ProviderStateSnapshot = {
  accounts: string[];
  chainId: string | null;
  networkVersion: string | null;
  isUnlocked: boolean;
};

export type ProviderSnapshot = {
  connected: boolean;
  chainId: string | null;
  caip2: string | null;
  accounts: string[];
  isUnlocked: boolean | null;
  meta: TransportMeta | null;
};

export type ProviderPatch =
  | { type: "accounts"; accounts: string[] }
  | { type: "chain"; chainId: string; caip2?: string | null; isUnlocked?: boolean; meta?: TransportMeta | null }
  | { type: "unlock"; isUnlocked: boolean }
  | { type: "meta"; meta: TransportMeta | null };

const didAccountsChange = (prev: string[], next: string[]) => {
  if (prev.length !== next.length) return true;
  return prev.some((value, index) => value !== next[index]);
};

export class Eip155ProviderState {
  #namespace: string = DEFAULT_NAMESPACE;
  #chainId: string | null = null;
  #caip2: string | null = null;
  #accounts: string[] = [];
  #isUnlocked: boolean | null = null;
  #meta: TransportMeta | null = null;

  get namespace() {
    return this.#namespace;
  }

  get caip2() {
    return this.#caip2;
  }

  get chainId() {
    return this.#chainId;
  }

  get isUnlocked() {
    return this.#isUnlocked;
  }

  get selectedAddress() {
    return this.#accounts[0] ?? null;
  }

  get accounts() {
    return [...this.#accounts];
  }

  getProviderState(): ProviderStateSnapshot {
    return {
      accounts: [...this.#accounts],
      chainId: this.#chainId,
      networkVersion: this.#resolveNetworkVersion(),
      isUnlocked: this.#isUnlocked ?? false,
    };
  }

  applySnapshot(snapshot: ProviderSnapshot): { accountsChanged: boolean } {
    const prevAccounts = [...this.#accounts];

    this.#updateMeta(snapshot.meta);
    const effectiveCaip2 = this.#resolveEffectiveCaip2(snapshot.caip2);
    this.#updateNamespace(effectiveCaip2);

    this.#chainId = snapshot.chainId;
    this.#accounts = snapshot.accounts;
    this.#isUnlocked = snapshot.isUnlocked;

    return { accountsChanged: didAccountsChange(prevAccounts, this.#accounts) };
  }

  applyPatch(patch: ProviderPatch): {
    chainChanged?: string;
    accountsChanged?: string[];
    unlockChanged?: { isUnlocked: boolean };
  } {
    const prevChainId = this.#chainId;
    const prevAccounts = [...this.#accounts];
    const prevUnlock = this.#isUnlocked;

    switch (patch.type) {
      case "meta": {
        this.#updateMeta(patch.meta);
        return {};
      }

      case "accounts": {
        this.#accounts = patch.accounts;
        if (didAccountsChange(prevAccounts, this.#accounts)) {
          return { accountsChanged: [...this.#accounts] };
        }
        return {};
      }

      case "unlock": {
        this.#isUnlocked = patch.isUnlocked;
        if (prevUnlock !== this.#isUnlocked) {
          return { unlockChanged: { isUnlocked: patch.isUnlocked } };
        }
        return {};
      }

      case "chain": {
        if (patch.meta !== undefined) {
          this.#updateMeta(patch.meta);
        }
        const effectiveCaip2 = this.#resolveEffectiveCaip2(patch.caip2);
        this.#updateNamespace(effectiveCaip2);

        this.#chainId = patch.chainId;
        if (typeof patch.isUnlocked === "boolean") {
          this.#isUnlocked = patch.isUnlocked;
        }

        if (prevChainId !== this.#chainId && this.#chainId) {
          return { chainChanged: this.#chainId };
        }
        return {};
      }

      default: {
        const _exhaustive: never = patch;
        return _exhaustive;
      }
    }
  }

  reset() {
    this.#namespace = DEFAULT_NAMESPACE;
    this.#chainId = null;
    this.#caip2 = null;
    this.#accounts = [];
    this.#isUnlocked = null;
    this.#meta = null;
  }

  #updateNamespace(caip2: string | null | undefined) {
    if (caip2 === undefined) return;

    if (typeof caip2 === "string" && caip2.length > 0) {
      this.#caip2 = caip2;
      const [namespace] = caip2.split(":");
      this.#namespace = namespace ?? DEFAULT_NAMESPACE;
      return;
    }

    this.#caip2 = null;
    this.#namespace = DEFAULT_NAMESPACE;
  }

  #updateMeta(meta: TransportMeta | null | undefined) {
    if (meta === undefined) return;
    this.#meta = meta ? cloneTransportMeta(meta) : null;
  }

  #resolveEffectiveCaip2(candidate: unknown): string | null {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
    return this.#meta?.activeChain ?? null;
  }

  #resolveNumericReference(candidate: string | null | undefined) {
    if (typeof candidate !== "string" || candidate.length === 0) return null;
    const [, reference = candidate] = candidate.split(":");
    return /^\d+$/.test(reference) ? reference : null;
  }

  #resolveNetworkVersion(): string | null {
    if (typeof this.#chainId === "string") {
      try {
        return BigInt(this.#chainId).toString(10);
      } catch {
        // swallow malformed hex to fall back on CAIP references
      }
    }
    return this.#resolveNumericReference(this.#caip2) ?? this.#resolveNumericReference(this.#meta?.activeChain);
  }
}
