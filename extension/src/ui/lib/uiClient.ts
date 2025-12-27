import type { ArxReason } from "@arx/core";
import {
  UI_CHANNEL,
  type UiAccountMeta,
  type UiKeyringMeta,
  type UiMessage,
  type UiPortEnvelope,
  type UiSnapshot,
} from "@arx/core/ui";
import browser from "webextension-polyfill";

type UiRemoteError = Error & { reason?: ArxReason; data?: unknown };

type PendingRequest<T = unknown> = {
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const REQUEST_TIMEOUT_MS = 30_000;

class UiClient {
  #port: browser.Runtime.Port | null = null;
  #pending = new Map<string, PendingRequest<unknown>>();
  #listeners = new Set<(snapshot: UiSnapshot) => void>();
  #approvalsListeners = new Set<(approvals: UiSnapshot["approvals"]) => void>();
  #unlockedListeners = new Set<(payload: { at: number }) => void>();

  // Use arrow functions to ensure `this` binding is stable
  connect = () => {
    if (this.#port) {
      return this.#port;
    }

    const port = browser.runtime.connect({ name: UI_CHANNEL });
    this.#port = port;

    port.onMessage.addListener((message: unknown) => {
      const envelope = message as UiPortEnvelope;
      if (!envelope || typeof envelope !== "object") {
        return;
      }

      if (envelope.type === "ui:response") {
        this.#resolveRequest(envelope.requestId, envelope.result);
        return;
      }

      if (envelope.type === "ui:error") {
        const error = new Error(envelope.error.message) as UiRemoteError;
        error.reason = envelope.error.reason;
        if (envelope.error.data !== undefined) {
          error.data = envelope.error.data;
        }
        this.#rejectRequest(envelope.requestId, error);
        return;
      }

      if (envelope.type === "ui:event") {
        switch (envelope.event) {
          case "ui:stateChanged": {
            for (const listener of this.#listeners) {
              listener(envelope.payload);
            }
            return;
          }
          case "ui:approvalsChanged": {
            console.debug("[uiClient] ui:approvalsChanged", { count: envelope.payload.length });
            for (const listener of this.#approvalsListeners) {
              listener(envelope.payload);
            }
            return;
          }
          case "ui:unlocked": {
            console.debug("[uiClient] ui:unlocked", envelope.payload);
            for (const listener of this.#unlockedListeners) {
              listener(envelope.payload);
            }
            return;
          }
          default:
            return;
        }
      }
    });

    port.onDisconnect.addListener(() => {
      for (const pending of this.#pending.values()) {
        pending.reject(new Error("UI bridge disconnected"));
        clearTimeout(pending.timeout);
      }
      this.#pending.clear();
      this.#port = null;
    });

    return port;
  };

  disconnect = () => {
    this.#port?.disconnect();
    this.#port = null;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
    }
    this.#pending.clear();
    this.#listeners.clear();
    this.#approvalsListeners.clear();
    this.#unlockedListeners.clear();
  };

  onStateChanged = (listener: (snapshot: UiSnapshot) => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  onApprovalsChanged = (listener: (approvals: UiSnapshot["approvals"]) => void) => {
    this.#approvalsListeners.add(listener);
    return () => {
      this.#approvalsListeners.delete(listener);
    };
  };

  onUnlocked = (listener: (payload: { at: number }) => void) => {
    this.#unlockedListeners.add(listener);
    return () => {
      this.#unlockedListeners.delete(listener);
    };
  };

  request = async <T = unknown>(payload: UiMessage): Promise<T> => {
    const port = this.connect();
    const requestId = crypto.randomUUID();

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.#pending.has(requestId)) {
          this.#pending.delete(requestId);
          reject(new Error("UI request timed out"));
        }
      }, REQUEST_TIMEOUT_MS);

      this.#pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timeout });

      const envelope: UiPortEnvelope = { type: "ui:request", requestId, payload };
      port.postMessage(envelope);
    });
  };

  #resolveRequest(id: string, result: unknown) {
    const pending = this.#pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.#pending.delete(id);
    pending.resolve(result);
  }

  #rejectRequest(id: string, error: Error) {
    const pending = this.#pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.#pending.delete(id);
    pending.reject(error);
  }

  getSnapshot = () => {
    return this.request<UiSnapshot>({ type: "ui:getSnapshot" });
  };

  vaultInit = (password: string) => {
    return this.request({ type: "ui:vaultInit", payload: { password } });
  };

  unlock = (password: string) => {
    return this.request<{ isUnlocked: boolean; nextAutoLockAt: number | null }>({
      type: "ui:unlock",
      payload: { password },
    });
  };

  lock = () => {
    return this.request<void>({ type: "ui:lock" });
  };

  resetAutoLockTimer = () => {
    return this.request<void>({ type: "ui:resetAutoLockTimer" });
  };

  switchAccount = (chainRef: string, address?: string | null) => {
    return this.request<string | null>({
      type: "ui:switchAccount",
      payload: { chainRef, address: address ?? null },
    });
  };

  switchChain = (chainRef: string) => {
    return this.request<UiSnapshot["chain"]>({
      type: "ui:switchChain",
      payload: { chainRef },
    });
  };

  approveApproval = (id: string) => {
    return this.request<{ id: string }>({ type: "ui:approve", payload: { id } });
  };

  rejectApproval = (id: string, reason?: string) => {
    return this.request<{ id: string }>({ type: "ui:reject", payload: { id, reason } });
  };

  setAutoLockDuration = (durationMs: number) => {
    return this.request<{ autoLockDurationMs: number; nextAutoLockAt: number | null }>({
      type: "ui:setAutoLockDuration",
      payload: { durationMs },
    });
  };

  generateMnemonic = (wordCount?: 12 | 24) => {
    return this.request<{ words: string[] }>({
      type: "ui:generateMnemonic",
      payload: wordCount ? { wordCount } : {},
    });
  };

  confirmNewMnemonic = (params: { words: string[]; alias?: string; skipBackup?: boolean; namespace?: string }) => {
    return this.request<{ keyringId: string; address?: string | null }>({
      type: "ui:confirmNewMnemonic",
      payload: params,
    });
  };

  importMnemonic = (params: { words: string[]; alias?: string; namespace?: string }) => {
    return this.request<{ keyringId: string; address?: string | null }>({
      type: "ui:importMnemonic",
      payload: params,
    });
  };

  importPrivateKey = (params: { privateKey: string; alias?: string; namespace?: string }) => {
    return this.request<{ keyringId: string; account: { address: string; derivationIndex?: number | null } }>({
      type: "ui:importPrivateKey",
      payload: params,
    });
  };

  deriveAccount = (keyringId: string) => {
    return this.request<{ address: string; derivationPath?: string | null; derivationIndex?: number | null }>({
      type: "ui:deriveAccount",
      payload: { keyringId },
    });
  };

  getKeyrings = () => this.request<UiKeyringMeta[]>({ type: "ui:getKeyrings" });

  getAccountsByKeyring = (params: { keyringId: string; includeHidden?: boolean }) => {
    return this.request<UiAccountMeta[]>({
      type: "ui:getAccountsByKeyring",
      payload: { keyringId: params.keyringId, includeHidden: params.includeHidden ?? false },
    });
  };

  renameKeyring = (params: { keyringId: string; alias: string }) =>
    this.request<void>({ type: "ui:renameKeyring", payload: params });

  renameAccount = (params: { address: string; alias: string }) =>
    this.request<void>({ type: "ui:renameAccount", payload: params });

  markBackedUp = (keyringId: string) => this.request<void>({ type: "ui:markBackedUp", payload: { keyringId } });

  hideHdAccount = (address: string) => this.request<void>({ type: "ui:hideHdAccount", payload: { address } });

  unhideHdAccount = (address: string) => this.request<void>({ type: "ui:unhideHdAccount", payload: { address } });

  removePrivateKeyKeyring = (keyringId: string) =>
    this.request<void>({ type: "ui:removePrivateKeyKeyring", payload: { keyringId } });

  exportMnemonic = (params: { keyringId: string; password: string }) =>
    this.request<{ words: string[] }>({ type: "ui:exportMnemonic", payload: params });

  exportPrivateKey = (params: { address: string; password: string }) =>
    this.request<{ privateKey: string }>({ type: "ui:exportPrivateKey", payload: params });
}

export const uiClient = new UiClient();
