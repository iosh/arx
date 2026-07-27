import { RpcInvalidParamsError, RpcNodeResponseError } from "@arx/core/rpc";
import type { CoreRuntime } from "@arx/core/runtime";
import type { DuplexChannel, MessageListener } from "@arx/message-channel";
import { describe, expect, it, vi } from "vitest";
import type { PageToWalletMessage, WalletToPageMessage } from "../protocol/messages.js";
import { createDappTransportHost } from "./dappTransportHost.js";

type DappConnectionsApi = CoreRuntime["dappConnections"];
type DappConnectionScope = Parameters<DappConnectionsApi["openConnection"]>[0];
type DappConnectionState = ReturnType<DappConnectionsApi["getConnectionState"]>;
type DappConnectionRequest = Parameters<DappConnectionsApi["request"]>[0];
type StateChangedListener = Parameters<DappConnectionsApi["subscribeStateChanged"]>[0];
type DappConnectionStateChanged = Parameters<StateChangedListener>[0];

const connectionState = (scope: DappConnectionScope): DappConnectionState => ({
  chainRef: `${scope.namespace}:1`,
  accounts: [],
});

const createDappConnections = () => {
  let stateChangedListener: StateChangedListener = () => undefined;
  const openConnection = vi.fn((scope: DappConnectionScope) => connectionState(scope));
  const getConnectionState = vi.fn((scope: DappConnectionScope) => connectionState(scope));
  const closeConnection = vi.fn((_scope: DappConnectionScope) => undefined);
  const request = vi.fn(async (input: DappConnectionRequest): Promise<unknown> => input.method);
  const subscribeStateChanged = vi.fn((listener: StateChangedListener) => {
    stateChangedListener = listener;
    return () => undefined;
  });
  const api = {
    openConnection,
    getConnectionState,
    closeConnection,
    request,
    subscribeStateChanged,
  } satisfies DappConnectionsApi;

  return {
    api,
    openConnection,
    getConnectionState,
    closeConnection,
    request,
    subscribeStateChanged,
    publishStateChanged: (change: DappConnectionStateChanged) => stateChangedListener(change),
  };
};

const createTestChannel = () => {
  const messageListeners = new Set<MessageListener>();
  const disconnectListeners = new Set<() => void>();
  const sent: WalletToPageMessage[] = [];
  let failNextSend = false;

  const channel: DuplexChannel = {
    send(message) {
      if (failNextSend) {
        failNextSend = false;
        throw new Error("send failed");
      }

      sent.push(message as WalletToPageMessage);
    },
    onMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onDisconnect(listener) {
      disconnectListeners.add(listener);
      return () => disconnectListeners.delete(listener);
    },
  };

  return {
    channel,
    sent,
    receive: (message: PageToWalletMessage) => {
      for (const listener of [...messageListeners]) listener(message);
    },
    disconnect: () => {
      for (const listener of [...disconnectListeners]) listener();
    },
    rejectNextSend: () => {
      failNextSend = true;
    },
  };
};

const flushRequests = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("DappTransportHost", () => {
  it("opens each scope once and closes it after its last channel leaves", () => {
    const core = createDappConnections();
    const host = createDappTransportHost({ dappConnections: core.api });
    const first = createTestChannel();
    const second = createTestChannel();
    host.attach({ channel: first.channel, origin: "https://example.test" });
    host.attach({ channel: second.channel, origin: "https://example.test" });

    first.receive({ type: "open", namespace: "eip155" });
    first.receive({ type: "open", namespace: "eip155" });
    second.receive({ type: "open", namespace: "eip155" });
    first.receive({ type: "open", namespace: "solana" });

    expect(core.subscribeStateChanged).toHaveBeenCalledOnce();
    expect(core.openConnection.mock.calls.map(([scope]) => scope)).toEqual([
      { origin: "https://example.test", namespace: "eip155" },
      { origin: "https://example.test", namespace: "solana" },
    ]);
    expect(core.getConnectionState).toHaveBeenCalledTimes(2);

    first.disconnect();
    expect(core.closeConnection.mock.calls.map(([scope]) => scope)).toEqual([
      { origin: "https://example.test", namespace: "solana" },
    ]);

    second.disconnect();
    expect(core.closeConnection.mock.calls.map(([scope]) => scope)).toEqual([
      { origin: "https://example.test", namespace: "solana" },
      { origin: "https://example.test", namespace: "eip155" },
    ]);
  });

  it("fans out state changes only to channels attached to the changed scope", () => {
    const core = createDappConnections();
    const host = createDappTransportHost({ dappConnections: core.api });
    const first = createTestChannel();
    const second = createTestChannel();
    const otherOrigin = createTestChannel();
    host.attach({ channel: first.channel, origin: "https://example.test" });
    host.attach({ channel: second.channel, origin: "https://example.test" });
    host.attach({ channel: otherOrigin.channel, origin: "https://other.test" });
    first.receive({ type: "open", namespace: "eip155" });
    second.receive({ type: "open", namespace: "eip155" });
    otherOrigin.receive({ type: "open", namespace: "eip155" });
    first.sent.length = 0;
    second.sent.length = 0;
    otherOrigin.sent.length = 0;
    second.rejectNextSend();

    core.publishStateChanged({
      scope: { origin: "https://example.test", namespace: "eip155" },
      state: { chainRef: "eip155:10", accounts: ["0x1234"] },
      changedFields: { chainRef: true, accounts: true },
    });

    const expected: WalletToPageMessage = {
      type: "connection_changed",
      namespace: "eip155",
      connection: { chainRef: "eip155:10", accounts: ["0x1234"] },
      changed: { network: true, accounts: true },
    };
    expect(first.sent).toEqual([expected]);
    expect(second.sent).toEqual([]);
    expect(otherOrigin.sent).toEqual([]);

    first.disconnect();
    expect(core.closeConnection).toHaveBeenCalledWith({
      origin: "https://example.test",
      namespace: "eip155",
    });
  });

  it("routes opened requests and maps protocol errors without exposing unknown failures", async () => {
    const core = createDappConnections();
    const host = createDappTransportHost({ dappConnections: core.api });
    const page = createTestChannel();
    host.attach({ channel: page.channel, origin: "https://example.test" });

    page.receive({ type: "request", namespace: "eip155", id: 1, method: "eth_chainId" });
    expect(page.sent).toEqual([
      {
        type: "failure",
        namespace: "eip155",
        id: 1,
        error: { kind: "disconnected", message: "The provider is disconnected." },
      },
    ]);
    expect(core.request).not.toHaveBeenCalled();

    page.receive({ type: "open", namespace: "eip155" });
    page.sent.length = 0;
    page.receive({
      type: "request",
      namespace: "eip155",
      id: 2,
      method: "eth_getBalance",
      params: ["0x1234", "latest"],
    });
    await flushRequests();

    expect(core.request).toHaveBeenCalledWith({
      scope: { origin: "https://example.test", namespace: "eip155" },
      method: "eth_getBalance",
      params: ["0x1234", "latest"],
    });
    expect(page.sent).toEqual([{ type: "success", namespace: "eip155", id: 2, result: "eth_getBalance" }]);

    const failures = [
      {
        id: 3,
        source: new RpcInvalidParamsError({ message: "Invalid EIP-155 params." }),
        wire: { kind: "invalid_params", message: "Invalid EIP-155 params." },
      },
      {
        id: 4,
        source: new RpcNodeResponseError({
          rpcCode: -32000,
          message: "Node rejected the call.",
          data: { retryable: false },
        }),
        wire: {
          kind: "upstream_response",
          message: "Node rejected the call.",
          data: { code: -32000, data: { retryable: false } },
        },
      },
      {
        id: 5,
        source: new Error("private failure"),
        wire: { kind: "internal", message: "Internal error." },
      },
    ] as const;

    for (const failure of failures) {
      core.request.mockRejectedValueOnce(failure.source);
      page.receive({ type: "request", namespace: "eip155", id: failure.id, method: "failure" });
      await flushRequests();
      expect(page.sent.at(-1)).toEqual({
        type: "failure",
        namespace: "eip155",
        id: failure.id,
        error: failure.wire,
      });
    }
  });

  it("drops an in-flight result after its channel disconnects", async () => {
    const core = createDappConnections();
    let finishRequest: ((value: unknown) => void) | undefined;
    core.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRequest = resolve;
        }),
    );
    const host = createDappTransportHost({ dappConnections: core.api });
    const page = createTestChannel();
    host.attach({ channel: page.channel, origin: "https://example.test" });
    page.receive({ type: "open", namespace: "eip155" });
    page.sent.length = 0;

    page.receive({ type: "request", namespace: "eip155", id: 1, method: "slow" });
    page.disconnect();
    finishRequest?.("late result");
    await flushRequests();

    expect(page.sent).toEqual([]);
    expect(core.closeConnection).toHaveBeenCalledWith({
      origin: "https://example.test",
      namespace: "eip155",
    });
  });
});
