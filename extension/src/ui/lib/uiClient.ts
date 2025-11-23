import browser from "webextension-polyfill";
import type { UiSnapshot } from "@arx/core/ui";
import { UI_CHANNEL } from "@/entrypoints/background/uiBridge";

type UiRequestPayload =
  | { type: "ui:getSnapshot" }
  | { type: "ui:vaultInit"; payload: { password: string } }
  | { type: "ui:unlock"; payload: { password: string } }
  | { type: "ui:lock" }
  | { type: "ui:resetAutoLockTimer" }
  | { type: "ui:switchAccount"; payload: { chainRef: string; address: string | null } }
  | { type: "ui:switchChain"; payload: { chainRef: string } };

type PortEnvelope =
  | { type: "ui:request"; requestId: string; payload: UiRequestPayload }
  | { type: "ui:response"; requestId: string; result: unknown }
  | { type: "ui:error"; requestId: string; error: { message: string; code?: number; data?: unknown } }
  | { type: "ui:event"; event: "ui:stateChanged"; payload: UiSnapshot };

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
  #requestCounter = 0;

  // Use arrow functions to ensure `this` binding is stable
  connect = () => {
    if (this.#port) {
      return this.#port;
    }

    const port = browser.runtime.connect({ name: UI_CHANNEL });
    this.#port = port;

    port.onMessage.addListener((message: unknown) => {
      const envelope = message as PortEnvelope;
      if (!envelope || typeof envelope !== "object") {
        return;
      }

      if (envelope.type === "ui:response") {
        this.#resolveRequest(envelope.requestId, envelope.result);
        return;
      }

      if (envelope.type === "ui:error") {
        const error = new Error(envelope.error.message);
        if (envelope.error.code) {
          (error as Error & { code?: number }).code = envelope.error.code;
        }
        this.#rejectRequest(envelope.requestId, error);
        return;
      }

      if (envelope.type === "ui:event" && envelope.event === "ui:stateChanged" && envelope.payload) {
        for (const listener of this.#listeners) {
          listener(envelope.payload);
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
  };

  onStateChanged = (listener: (snapshot: UiSnapshot) => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  request = async <T = unknown>(payload: UiRequestPayload): Promise<T> => {
    const port = this.connect();
    const requestId = `ui-${Date.now()}-${++this.#requestCounter}`;

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.#pending.has(requestId)) {
          this.#pending.delete(requestId);
          reject(new Error("UI request timed out"));
        }
      }, REQUEST_TIMEOUT_MS);

      this.#pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timeout });

      const envelope: PortEnvelope = { type: "ui:request", requestId, payload };
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
}

export const uiClient = new UiClient();
