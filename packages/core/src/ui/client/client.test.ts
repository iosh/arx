import { describe, expect, it, vi } from "vitest";
import { UI_EVENT_SNAPSHOT_CHANGED } from "../events.js";
import { createUiClient, type UiTransport } from "./index.js";

const SNAPSHOT_FIXTURE = {
  chain: {
    chainRef: "eip155:1",
    chainId: "0x1",
    namespace: "eip155",
    displayName: "Ethereum",
    shortName: "eth",
    icon: null,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  networks: {
    active: "eip155:1",
    known: [
      {
        chainRef: "eip155:1",
        chainId: "0x1",
        namespace: "eip155",
        displayName: "Ethereum",
        shortName: "eth",
        icon: null,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      },
    ],
  },
  accounts: {
    totalCount: 0,
    list: [],
    active: null,
  },
  session: {
    isUnlocked: false,
    autoLockDurationMs: 900_000,
    nextAutoLockAt: null,
  },
  approvals: [],
  attention: {
    queue: [],
    count: 0,
  },
  permissions: {
    origins: {},
  },
  vault: {
    initialized: false,
  },
  warnings: {
    hdKeyringsNeedingBackup: [],
  },
} as const;

const createMockTransport = () => {
  const messageListeners = new Set<(m: unknown) => void>();
  const disconnectListeners = new Set<(e?: unknown) => void>();

  const sent: unknown[] = [];
  let connectCalls = 0;

  // Deterministic test sync point: await the next postMessage().
  const sentWaiters: Array<(m: unknown) => void> = [];
  const nextSent = () =>
    new Promise<unknown>((resolve) => {
      sentWaiters.push(resolve);
    });

  const transport: UiTransport & {
    sent: unknown[];
    connectCalls: () => number;
    emit: (m: unknown) => void;
    disconnectNow: (e?: unknown) => void;
    nextSent: () => Promise<unknown>;
  } = {
    connect: async () => {
      connectCalls += 1;
    },
    postMessage: (m) => {
      sent.push(m);
      const resolve = sentWaiters.shift();
      if (resolve) resolve(m);
    },
    onMessage: (fn) => {
      messageListeners.add(fn);
      return () => messageListeners.delete(fn);
    },
    onDisconnect: (fn) => {
      disconnectListeners.add(fn);
      return () => disconnectListeners.delete(fn);
    },

    sent,
    connectCalls: () => connectCalls,
    emit: (m) => {
      for (const fn of messageListeners) fn(m);
    },
    disconnectNow: (e) => {
      for (const fn of disconnectListeners) fn(e);
    },
    nextSent,
  };

  return transport;
};

describe("ui client runtime", () => {
  it("matches request/response and validates result", async () => {
    const transport = createMockTransport();
    const client = createUiClient({
      transport,
      createRequestId: () => "id1",
      requestTimeoutMs: 1_000,
    });

    try {
      const p = client.call("ui.approvals.reject", { id: "a" });

      const msg = await transport.nextSent();
      expect(msg).toMatchObject({
        type: "ui:request",
        id: "id1",
        method: "ui.approvals.reject",
        params: { id: "a" },
      });

      transport.emit({ type: "ui:response", id: "id1", result: { id: "a" } });
      await expect(p).resolves.toEqual({ id: "a" });
    } finally {
      client.destroy();
    }
  });

  it("rejects with UiRemoteError on ui:error", async () => {
    const transport = createMockTransport();
    const client = createUiClient({ transport, createRequestId: () => "id1", requestTimeoutMs: 1_000 });

    try {
      const p = client.call("ui.approvals.reject", { id: "a" });

      await transport.nextSent();

      transport.emit({
        type: "ui:error",
        id: "id1",
        error: { reason: "RpcInvalidRequest", message: "nope" },
        context: { namespace: "eip155", chainRef: "eip155:1" },
      });

      await expect(p).rejects.toMatchObject({
        name: "UiRemoteError",
        reason: "RpcInvalidRequest",
        message: "nope",
        context: { namespace: "eip155", chainRef: "eip155:1" },
      });
    } finally {
      client.destroy();
    }
  });

  it("rejects a pending request when a reply envelope is invalid but correlatable", async () => {
    const transport = createMockTransport();
    const client = createUiClient({ transport, createRequestId: () => "id1", requestTimeoutMs: 1_000 });

    try {
      const p = client.call("ui.approvals.reject", { id: "a" });

      await transport.nextSent();

      transport.emit({ type: "ui:response", id: "id1" });

      await expect(p).rejects.toMatchObject({ name: "UiProtocolError" });
    } finally {
      client.destroy();
    }
  });
  it("waitForSnapshot resolves after snapshotChanged", async () => {
    const transport = createMockTransport();
    const client = createUiClient({ transport });

    const p = client.waitForSnapshot({ timeoutMs: 1_000 });

    transport.emit({
      type: "ui:event",
      event: UI_EVENT_SNAPSHOT_CHANGED,
      payload: SNAPSHOT_FIXTURE,
    });

    await expect(p).resolves.toMatchObject({ chain: { chainId: "0x1" } });

    client.destroy();
  });

  it("reconnects on disconnect when there is at least one event listener", async () => {
    vi.useFakeTimers();

    const transport = createMockTransport();
    const client = createUiClient({ transport });

    const unsubscribe = client.on(UI_EVENT_SNAPSHOT_CHANGED, () => {});

    // First connect is async; allow it to start.
    await Promise.resolve();

    transport.disconnectNow(new Error("port disconnected"));

    vi.advanceTimersByTime(300);
    await vi.runAllTimersAsync();

    expect(transport.connectCalls()).toBeGreaterThanOrEqual(2);

    unsubscribe();
    client.destroy();

    vi.useRealTimers();
  });
});
