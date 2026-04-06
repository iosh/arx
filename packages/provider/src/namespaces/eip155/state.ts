import { parseChainRef } from "@arx/core";
import { cloneTransportMeta } from "../../transport/transportMeta.js";
import type { TransportMeta } from "../../types/transport.js";
import { EIP155_NAMESPACE } from "./constants.js";

export type ProviderStateSnapshot = {
  accounts: string[];
  chainId: string | null;
  networkVersion: string | null;
  isUnlocked: boolean;
};

export type ProviderSnapshot = {
  connected: boolean;
  chainId: string | null;
  chainRef: string | null;
  accounts: string[];
  isUnlocked: boolean | null;
  meta: TransportMeta | null;
};

export type ProviderPatch =
  | { type: "accounts"; accounts: string[] }
  | { type: "chain"; chainId: string; chainRef?: string | null; isUnlocked?: boolean; meta?: TransportMeta | null }
  | { type: "unlock"; isUnlocked: boolean }
  | { type: "meta"; meta: TransportMeta | null };

export const cloneProviderSnapshot = (snapshot: ProviderSnapshot): ProviderSnapshot => ({
  connected: snapshot.connected,
  chainId: snapshot.chainId,
  chainRef: snapshot.chainRef,
  accounts: [...snapshot.accounts],
  isUnlocked: snapshot.isUnlocked,
  meta: snapshot.meta ? cloneTransportMeta(snapshot.meta) : null,
});

export const cloneProviderPatch = (patch: ProviderPatch): ProviderPatch => {
  switch (patch.type) {
    case "accounts":
      return { type: "accounts", accounts: [...patch.accounts] };

    case "chain":
      return {
        type: "chain",
        chainId: patch.chainId,
        ...(patch.chainRef === undefined ? {} : { chainRef: patch.chainRef }),
        ...(patch.isUnlocked === undefined ? {} : { isUnlocked: patch.isUnlocked }),
        ...(patch.meta === undefined ? {} : { meta: patch.meta ? cloneTransportMeta(patch.meta) : null }),
      };

    case "unlock":
      return { type: "unlock", isUnlocked: patch.isUnlocked };

    case "meta":
      return { type: "meta", meta: patch.meta ? cloneTransportMeta(patch.meta) : null };

    default: {
      const exhaustive: never = patch;
      return exhaustive;
    }
  }
};

export const applyProviderPatch = (snapshot: ProviderSnapshot, patch: ProviderPatch): ProviderSnapshot => {
  const nextSnapshot = cloneProviderSnapshot(snapshot);

  switch (patch.type) {
    case "accounts":
      nextSnapshot.accounts = [...patch.accounts];
      return nextSnapshot;

    case "unlock":
      nextSnapshot.isUnlocked = patch.isUnlocked;
      return nextSnapshot;

    case "meta":
      nextSnapshot.meta = patch.meta ? cloneTransportMeta(patch.meta) : null;
      return nextSnapshot;

    case "chain":
      nextSnapshot.chainId = patch.chainId;
      if (patch.chainRef !== undefined) {
        nextSnapshot.chainRef = patch.chainRef;
      }
      if (patch.isUnlocked !== undefined) {
        nextSnapshot.isUnlocked = patch.isUnlocked;
      }
      if (patch.meta !== undefined) {
        nextSnapshot.meta = patch.meta ? cloneTransportMeta(patch.meta) : null;
      }
      return nextSnapshot;

    default: {
      const exhaustive: never = patch;
      return exhaustive;
    }
  }
};

const didAccountsChange = (prev: string[], next: string[]) => {
  if (prev.length !== next.length) return true;
  return prev.some((value, index) => value !== next[index]);
};

export class Eip155ProviderState {
  #namespace: string = EIP155_NAMESPACE;
  #chainId: string | null = null;
  #chainRef: string | null = null;
  #accounts: string[] = [];
  #isUnlocked: boolean | null = null;
  #meta: TransportMeta | null = null;

  get namespace() {
    return this.#namespace;
  }

  get chainRef() {
    return this.#chainRef;
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

  get networkVersion() {
    return this.#deriveNetworkVersion();
  }

  get accounts() {
    return [...this.#accounts];
  }

  getProviderState(): ProviderStateSnapshot {
    return {
      accounts: [...this.#accounts],
      chainId: this.#chainId,
      networkVersion: this.networkVersion,
      isUnlocked: this.#isUnlocked ?? false,
    };
  }

  applySnapshot(snapshot: ProviderSnapshot): { accountsChanged: boolean } {
    const prevAccounts = [...this.#accounts];

    this.#updateMeta(snapshot.meta);
    const effectiveChainRef = this.#deriveEffectiveChainRef(snapshot.chainRef);
    this.#updateNamespace(effectiveChainRef);

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
        const effectiveChainRef = this.#deriveEffectiveChainRef(patch.chainRef);
        this.#updateNamespace(effectiveChainRef);

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
    this.#namespace = EIP155_NAMESPACE;
    this.#chainId = null;
    this.#chainRef = null;
    this.#accounts = [];
    this.#isUnlocked = null;
    this.#meta = null;
  }

  #updateNamespace(chainRef: string | null | undefined) {
    if (chainRef === undefined) return;

    if (typeof chainRef === "string" && chainRef.length > 0) {
      this.#chainRef = chainRef;
      try {
        this.#namespace = parseChainRef(chainRef as never).namespace;
      } catch {
        this.#namespace = EIP155_NAMESPACE;
      }
      return;
    }

    this.#chainRef = null;
    this.#namespace = EIP155_NAMESPACE;
  }

  #updateMeta(meta: TransportMeta | null | undefined) {
    if (meta === undefined) return;
    this.#meta = meta ? cloneTransportMeta(meta) : null;
  }

  #deriveEffectiveChainRef(candidate: unknown): string | null {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
    return this.#meta?.activeChainByNamespace[EIP155_NAMESPACE] ?? null;
  }

  #parseNumericReference(candidate: string | null | undefined) {
    if (typeof candidate !== "string" || candidate.length === 0) return null;
    let reference = candidate;
    try {
      reference = parseChainRef(candidate as never).reference;
    } catch {
      // Fall back to legacy plain numeric strings.
    }
    return /^\d+$/.test(reference) ? reference : null;
  }

  #deriveNetworkVersion(): string | null {
    if (typeof this.#chainId === "string") {
      try {
        return BigInt(this.#chainId).toString(10);
      } catch {
        // swallow malformed hex to fall back on CAIP references
      }
    }
    return (
      this.#parseNumericReference(this.#chainRef) ??
      this.#parseNumericReference(this.#meta?.activeChainByNamespace[EIP155_NAMESPACE])
    );
  }
}
