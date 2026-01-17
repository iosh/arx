import type { ArxReason } from "@arx/core";
import {
  UI_CHANNEL,
  UI_EVENT_SNAPSHOT_CHANGED,
  parseUiEventPayload,
  parseUiMethodResult,
  type UiMethodName,
  type UiMethodParams,
  type UiMethodResult,
  type UiPortEnvelope,
  type UiSnapshot,
} from "@arx/core/ui";
import browser from "webextension-polyfill";

type UiRemoteError = Error & { reason?: ArxReason; data?: unknown };

type PendingRequest<T = unknown> = {
  method: UiMethodName;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const REQUEST_TIMEOUT_MS = 30_000;

class UiClient {
  #port: browser.Runtime.Port | null = null;
  #pending = new Map<string, PendingRequest<unknown>>();
  #snapshotListeners = new Set<(snapshot: UiSnapshot) => void>();
  #lastSnapshot: UiSnapshot | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectAttempts = 0;
  #closed = false;

  connect = () => {
    if (this.#port) return this.#port;

    this.#closed = false;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }

    const port = browser.runtime.connect({ name: UI_CHANNEL });
    this.#port = port;

    port.onMessage.addListener((message: unknown) => {
      const envelope = message as UiPortEnvelope;
      if (!envelope || typeof envelope !== "object") return;

      if (envelope.type === "ui:response") {
        this.#resolveRequest(envelope.id, envelope.result);
        return;
      }

      if (envelope.type === "ui:error") {
        const error = new Error(envelope.error.message) as UiRemoteError;
        error.reason = envelope.error.reason;
        if (envelope.error.data !== undefined) {
          error.data = envelope.error.data;
        }
        this.#rejectRequest(envelope.id, error);
        return;
      }

      if (envelope.type === "ui:event") {
        if (envelope.event !== UI_EVENT_SNAPSHOT_CHANGED) return;
        try {
          const snapshot = parseUiEventPayload(UI_EVENT_SNAPSHOT_CHANGED, envelope.payload);
          this.#lastSnapshot = snapshot;
          this.#reconnectAttempts = 0;
          for (const listener of this.#snapshotListeners) listener(snapshot);
        } catch (error) {
          console.warn("[uiClient] invalid snapshot payload", error);
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
      this.#scheduleReconnect();
    });

    return port;
  };

  #scheduleReconnect() {
    if (this.#closed) return;
    if (this.#port) return;
    if (this.#snapshotListeners.size === 0) return;
    if (this.#reconnectTimer) return;

    const attempt = this.#reconnectAttempts;
    this.#reconnectAttempts += 1;

    // Small backoff to avoid hot reconnect loops when BG is unavailable.
    const delayMs = Math.min(5_000, 200 * 2 ** attempt);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      try {
        this.connect();
      } catch (error) {
        console.warn("[uiClient] reconnect failed", error);
        this.#scheduleReconnect();
      }
    }, delayMs);
  }

  disconnect = () => {
    this.#closed = true;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#port?.disconnect();
    this.#port = null;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
    }
    this.#pending.clear();
    this.#snapshotListeners.clear();
    this.#lastSnapshot = null;
  };

  onSnapshotChanged = (listener: (snapshot: UiSnapshot) => void) => {
    this.#snapshotListeners.add(listener);
    return () => {
      this.#snapshotListeners.delete(listener);
    };
  };

  getLastSnapshot = () => this.#lastSnapshot;

  waitForSnapshot = async (opts?: { timeoutMs?: number; predicate?: (snapshot: UiSnapshot) => boolean }) => {
    const timeoutMs = opts?.timeoutMs ?? 30_000;
    const predicate = opts?.predicate;

    const existing = this.#lastSnapshot;
    if (existing && (!predicate || predicate(existing))) return existing;

    return await new Promise<UiSnapshot>((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const maybeResolve = (snapshot: UiSnapshot) => {
        if (settled) return;
        if (predicate && !predicate(snapshot)) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        unsubscribe();
        resolve(snapshot);
      };

      const unsubscribe = this.onSnapshotChanged(maybeResolve);

      // Subscribe before connecting, then re-check last snapshot to avoid races
      // where the first snapshot arrives between connect() and onSnapshotChanged().
      try {
        this.connect();
      } catch (error) {
        unsubscribe();
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      const postConnect = this.#lastSnapshot;
      if (postConnect) maybeResolve(postConnect);

      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        unsubscribe();
        reject(new Error("Timed out waiting for UI snapshot"));
      }, timeoutMs);
    });
  };

  call = async <M extends UiMethodName>(method: M, params?: UiMethodParams<M>): Promise<UiMethodResult<M>> => {
    const port = this.connect();
    const id = crypto.randomUUID();

    return new Promise<UiMethodResult<M>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.#pending.has(id)) {
          this.#pending.delete(id);
          reject(new Error("UI request timed out"));
        }
      }, REQUEST_TIMEOUT_MS);

      this.#pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject, timeout });
      try {
        port.postMessage({ type: "ui:request", id, method, params } satisfies UiPortEnvelope);
      } catch (error) {
        clearTimeout(timeout);
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  #resolveRequest(id: string, result: unknown) {
    const pending = this.#pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.#pending.delete(id);

    try {
      pending.resolve(parseUiMethodResult(pending.method, result));
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  #rejectRequest(id: string, error: Error) {
    const pending = this.#pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.#pending.delete(id);
    pending.reject(error);
  }

  getSnapshot = () => this.call("ui.snapshot.get");
  vaultInit = (password: string) => this.call("ui.vault.init", { password });
  vaultInitAndUnlock = (password: string) => this.call("ui.vault.initAndUnlock", { password });
  unlock = (password: string) => this.call("ui.session.unlock", { password });
  openOnboardingTab = (params: { reason: string }) => this.call("ui.onboarding.openTab", params);
  lock = () => this.call("ui.session.lock", {});
  resetAutoLockTimer = () => this.call("ui.session.resetAutoLockTimer");
  setAutoLockDuration = (durationMs: number) => this.call("ui.session.setAutoLockDuration", { durationMs });
  switchAccount = (chainRef: string, address?: string | null) =>
    this.call("ui.accounts.switchActive", { chainRef, address: address ?? null });
  switchChain = (chainRef: string) => this.call("ui.networks.switchActive", { chainRef });

  approveApproval = (id: string) => this.call("ui.approvals.approve", { id });
  rejectApproval = (id: string, reason?: string) => this.call("ui.approvals.reject", { id, reason });

  generateMnemonic = (wordCount?: 12 | 24) =>
    this.call("ui.keyrings.generateMnemonic", wordCount ? { wordCount } : undefined);
  confirmNewMnemonic = (params: { words: string[]; alias?: string; skipBackup?: boolean; namespace?: string }) =>
    this.call("ui.keyrings.confirmNewMnemonic", params);
  importMnemonic = (params: { words: string[]; alias?: string; namespace?: string }) =>
    this.call("ui.keyrings.importMnemonic", params);
  importPrivateKey = (params: { privateKey: string; alias?: string; namespace?: string }) =>
    this.call("ui.keyrings.importPrivateKey", params);
  deriveAccount = (keyringId: string) => this.call("ui.keyrings.deriveAccount", { keyringId });
  getKeyrings = () => this.call("ui.keyrings.list");
  getAccountsByKeyring = (params: { keyringId: string; includeHidden?: boolean }) =>
    this.call("ui.keyrings.getAccountsByKeyring", params);
  renameKeyring = (params: { keyringId: string; alias: string }) => this.call("ui.keyrings.renameKeyring", params);
  renameAccount = (params: { address: string; alias: string }) => this.call("ui.keyrings.renameAccount", params);
  markBackedUp = (keyringId: string) => this.call("ui.keyrings.markBackedUp", { keyringId });
  hideHdAccount = (address: string) => this.call("ui.keyrings.hideHdAccount", { address });
  unhideHdAccount = (address: string) => this.call("ui.keyrings.unhideHdAccount", { address });
  removePrivateKeyKeyring = (keyringId: string) => this.call("ui.keyrings.removePrivateKeyKeyring", { keyringId });
  exportMnemonic = (params: { keyringId: string; password: string }) => this.call("ui.keyrings.exportMnemonic", params);
  exportPrivateKey = (params: { address: string; password: string }) =>
    this.call("ui.keyrings.exportPrivateKey", params);
}

export const uiClient = new UiClient();
