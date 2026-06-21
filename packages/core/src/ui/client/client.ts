import { parseUiEnvelope, type UiPortEnvelope } from "../protocol/envelopes.js";
import {
  parseUiMethodParams,
  type UiEventName,
  type UiEventPayload,
  type UiMethodName,
  type UiMethodParams,
  type UiMethodResult,
} from "../protocol/index.js";
import {
  type PendingRequest,
  type UiClient,
  type UiClientConnectionStatus,
  type UiClientOptions,
  UiProtocolError,
  UiRemoteError,
  type UiTransport,
} from "./types.js";

const REQUEST_TIMEOUT_MS = 30_000;

const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));
const createError = (message: string, cause?: unknown): Error => {
  const error = new Error(message);
  if (cause !== undefined) (error as { cause?: unknown }).cause = cause;
  return error;
};

const defaultCreateRequestId = () => {
  return globalThis.crypto.randomUUID();
};

const calcBackoffMs = (attempt: number) => Math.min(5_000, 200 * 2 ** attempt);

export const createUiClient = (args: { transport: UiTransport } & UiClientOptions): UiClient => {
  const { transport } = args;
  const requestTimeoutMs = args.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const createRequestId = args.createRequestId ?? defaultCreateRequestId;
  const logger = args.logger;

  let destroyed = false;

  const pending = new Map<string, PendingRequest>();

  const listeners = new Map<UiEventName, Set<(payload: unknown) => void>>();
  const connectionStatusListeners = new Set<(status: UiClientConnectionStatus) => void>();

  // Connection state + generation token to avoid connect/disconnect races.
  let connected = false;
  let connectPromise: Promise<void> | null = null;
  let connectGen = 0;
  let needsReconnect = false;

  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;

  const totalListenerCount = () => {
    let total = 0;
    for (const set of listeners.values()) total += set.size;
    return total + connectionStatusListeners.size;
  };

  const clearReconnectTimer = () => {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const rejectAllPending = (error: Error) => {
    for (const req of pending.values()) {
      try {
        req.reject(error);
      } finally {
        clearTimeout(req.timeout);
        req.abortUnsubscribe?.();
      }
    }
    pending.clear();
  };

  const emitConnectionStatus = (status: UiClientConnectionStatus) => {
    for (const listener of connectionStatusListeners) {
      try {
        listener(status);
      } catch (error) {
        logger?.error?.("[uiClient] connection status listener threw", error);
      }
    }
  };

  const scheduleReconnect = () => {
    if (destroyed) return;
    if (connected) return;
    if (reconnectTimer) return;
    if (totalListenerCount() === 0) return;

    const attempt = reconnectAttempts;
    reconnectAttempts += 1;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect().catch((error) => {
        logger?.warn?.("[uiClient] reconnect failed", error);
        scheduleReconnect();
      });
    }, calcBackoffMs(attempt));
  };

  const connect = async () => {
    if (destroyed) throw new Error("UiClient is destroyed");
    if (connected) return;
    if (connectPromise) return await connectPromise;

    clearReconnectTimer();

    const gen = ++connectGen;
    needsReconnect = false;

    connectPromise = transport
      .connect()
      .then(() => {
        // If a disconnect happened while we were connecting, do not mark as connected.
        if (destroyed) return;
        if (gen !== connectGen) return;
        if (needsReconnect) return;

        connected = true;
        emitConnectionStatus("connected");
      })
      .finally(() => {
        connectPromise = null;
      });

    try {
      await connectPromise;
      if (!connected) {
        // Connect finished but we didn't enter a connected state (race/disconnect).
        scheduleReconnect();
      }
    } catch (error) {
      connected = false;
      scheduleReconnect();
      throw error;
    }
  };

  const handleDisconnect = (error?: unknown) => {
    if (destroyed) return;
    const wasConnected = connected;

    // Invalidate any in-flight connect completion.
    connectGen += 1;
    needsReconnect = true;

    connected = false;
    rejectAllPending(new Error("UI bridge disconnected"));

    if (wasConnected) {
      emitConnectionStatus("disconnected");
    }

    if (error) logger?.warn?.("[uiClient] disconnected", error);
    scheduleReconnect();
  };

  const rejectPendingProtocolError = (id: string, detail: string, cause?: unknown) => {
    const req = pending.get(id);
    if (!req) return;

    const err = new UiProtocolError(`UI protocol error: ${detail}`);
    (err as { cause?: unknown }).cause = cause;

    clearTimeout(req.timeout);
    req.abortUnsubscribe?.();
    pending.delete(id);
    req.reject(err);
  };

  const onMessageUnsub = transport.onMessage((raw: unknown) => {
    if (destroyed) return;

    let envelope: UiPortEnvelope;
    try {
      envelope = parseUiEnvelope(raw);
    } catch (error) {
      const maybe = raw as { type?: unknown; id?: unknown } | null;

      if (
        maybe &&
        typeof maybe === "object" &&
        (maybe.type === "ui:response" || maybe.type === "ui:error") &&
        typeof maybe.id === "string"
      ) {
        rejectPendingProtocolError(maybe.id, "Invalid reply envelope", error);
        return;
      }

      logger?.warn?.("[uiClient] invalid envelope (ignored)", error);
      return;
    }

    if (envelope.type === "ui:response") {
      const req = pending.get(envelope.id);
      if (!req) return;

      clearTimeout(req.timeout);
      req.abortUnsubscribe?.();
      pending.delete(envelope.id);

      req.resolve(envelope.result);
      return;
    }

    if (envelope.type === "ui:error") {
      const req = pending.get(envelope.id);
      if (!req) return;

      clearTimeout(req.timeout);
      req.abortUnsubscribe?.();
      pending.delete(envelope.id);

      req.reject(new UiRemoteError(envelope.error, envelope.context));
      return;
    }

    if (envelope.type === "ui:event") {
      const payload = envelope.payload as UiEventPayload<typeof envelope.event>;

      reconnectAttempts = 0;

      const set = listeners.get(envelope.event);
      if (!set || set.size === 0) return;

      for (const fn of set) {
        try {
          fn(payload);
        } catch (error) {
          logger?.error?.("[uiClient] event listener threw", error);
        }
      }
    }
  });

  const onDisconnectUnsub = transport.onDisconnect?.((error) => handleDisconnect(error));

  const on: UiClient["on"] = (event, listener) => {
    if (destroyed) throw new Error("UiClient is destroyed");

    const set = listeners.get(event) ?? new Set<(payload: unknown) => void>();
    set.add(listener as unknown as (payload: unknown) => void);
    listeners.set(event, set);

    void connect().catch((error) => {
      logger?.warn?.("[uiClient] connect failed", error);
    });

    return () => {
      const current = listeners.get(event);
      if (!current) return;
      current.delete(listener as unknown as (payload: unknown) => void);
      if (current.size === 0) listeners.delete(event);
      if (totalListenerCount() === 0) {
        clearReconnectTimer();
      }
    };
  };

  const onConnectionStatus: UiClient["onConnectionStatus"] = (listener) => {
    if (destroyed) throw new Error("UiClient is destroyed");

    connectionStatusListeners.add(listener);

    void connect().catch((error) => {
      logger?.warn?.("[uiClient] connect failed", error);
    });

    return () => {
      connectionStatusListeners.delete(listener);
      if (totalListenerCount() === 0) {
        clearReconnectTimer();
      }
    };
  };

  const call: UiClient["call"] = async <M extends UiMethodName>(
    method: M,
    params?: UiMethodParams<M>,
    opts?: { signal?: AbortSignal },
  ): Promise<UiMethodResult<M>> => {
    if (destroyed) throw new Error("UiClient is destroyed");

    const parsedParams = parseUiMethodParams(method, params);

    await connect();

    const id = createRequestId();

    return await new Promise<UiMethodResult<M>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!pending.has(id)) return;
        record.abortUnsubscribe?.();
        pending.delete(id);
        reject(createError("UI request timed out"));
      }, requestTimeoutMs);

      const record: PendingRequest = {
        method,
        resolve: resolve as unknown as (value: unknown) => void,
        reject,
        timeout,
      };

      const signal = opts?.signal;
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timeout);
          reject(new Error("Aborted"));
          return;
        }

        const onAbort = () => {
          if (!pending.has(id)) return;
          clearTimeout(timeout);
          pending.delete(id);
          reject(createError("UI request aborted"));
        };

        signal.addEventListener("abort", onAbort, { once: true });
        record.abortUnsubscribe = () => signal.removeEventListener("abort", onAbort);
      }

      pending.set(id, record);

      try {
        const msg =
          parsedParams === undefined
            ? ({ type: "ui:request", id, method } satisfies UiPortEnvelope)
            : ({ type: "ui:request", id, method, params: parsedParams } satisfies UiPortEnvelope);

        transport.postMessage(msg);
      } catch (error) {
        clearTimeout(timeout);
        record.abortUnsubscribe?.();
        pending.delete(id);
        reject(toError(error));
      }
    });
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;

    clearReconnectTimer();
    connected = false;

    rejectAllPending(new Error("UiClient destroyed"));

    listeners.clear();
    connectionStatusListeners.clear();

    try {
      onMessageUnsub();
    } catch (error) {
      logger?.warn?.("[uiClient] failed to unsubscribe onMessage", error);
    }
    try {
      onDisconnectUnsub?.();
    } catch (error) {
      logger?.warn?.("[uiClient] failed to unsubscribe onDisconnect", error);
    }

    try {
      transport.disconnect?.();
    } catch (error) {
      logger?.warn?.("[uiClient] failed to disconnect transport", error);
    }
  };

  const base = { connect, call, on, onConnectionStatus, destroy };

  const extend: UiClient["extend"] = function <E extends Record<string, unknown>>(
    this: UiClient & Record<string, unknown>,
    extension: (client: UiClient) => E,
  ) {
    const ext = extension(this);

    for (const key of Object.keys(ext)) {
      if (key in this) {
        throw new Error(`UiClient.extend() conflict: "${key}" already exists on client`);
      }
    }

    return Object.assign({}, this, ext) as UiClient & E;
  };

  return Object.assign({}, base, { extend }) as UiClient;
};
