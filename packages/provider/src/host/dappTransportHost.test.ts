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

const connectionState = (scope: DappConnectionScope): DappConnectionState => ({
  chainRef: `${scope.namespace}:1`,
  accounts: [],
});

const createDappConnections = () => {
  const openConnection = vi.fn((scope: DappConnectionScope) => connectionState(scope));
  const getConnectionState = vi.fn((scope: DappConnectionScope) => connectionState(scope));
  const closeConnection = vi.fn((_scope: DappConnectionScope) => undefined);
  const request = vi.fn(async (input: DappConnectionRequest): Promise<unknown> => input.method);
  const subscribeStateChanged = vi.fn((_listener: StateChangedListener) => () => undefined);
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
  };
};

const createTestChannel = () => {
  const messageListeners = new Set<MessageListener>();
  const disconnectListeners = new Set<() => void>();
  const sent: WalletToPageMessage[] = [];

  const channel: DuplexChannel = {
    send(message) {
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
