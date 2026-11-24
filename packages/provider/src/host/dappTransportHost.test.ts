import { PersistenceCommitError } from "@arx/core/persistence";
import type { CoreRuntime } from "@arx/core/runtime";
import type { DuplexChannel, MessageListener } from "@arx/message-channel";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageToWalletMessage, WalletToPageMessage } from "../protocol/messages.js";
import { createDappTransportHost } from "./dappTransportHost.js";

type DappConnectionsApi = CoreRuntime["dappConnections"];
type DappConnectionState = ReturnType<DappConnectionsApi["getConnectionState"]>;

const connectionState: DappConnectionState = {
  chainRef: "eip155:1",
  accounts: [],
};

const createDappConnections = () => {
  const closeConnection = vi.fn<DappConnectionsApi["closeConnection"]>();
  const request = vi.fn<DappConnectionsApi["request"]>(async (input) => input.method);
  const api = {
    openConnection: () => connectionState,
    getConnectionState: () => connectionState,
    closeConnection,
    request,
    subscribeStateChanged: () => () => {},
  } satisfies DappConnectionsApi;

  return {
    api,
    closeConnection,
    request,
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

afterEach(() => vi.restoreAllMocks());

describe("DappTransportHost", () => {
  it("closes each site scope only after its final channel disconnects", () => {
    const core = createDappConnections();
    const host = createDappTransportHost({ dappConnections: core.api });
    const first = createTestChannel();
    const second = createTestChannel();
    const otherSite = createTestChannel();
    host.attach({ channel: first.channel, origin: "https://example.test" });
    host.attach({ channel: second.channel, origin: "https://example.test" });
    host.attach({ channel: otherSite.channel, origin: "https://other.test" });

    first.receive({ type: "open", namespace: "eip155" });
    first.receive({ type: "open", namespace: "eip155" });
    second.receive({ type: "open", namespace: "eip155" });
    otherSite.receive({ type: "open", namespace: "eip155" });

    first.disconnect();
    expect(core.closeConnection).not.toHaveBeenCalled();

    otherSite.disconnect();
    expect(core.closeConnection.mock.calls.map(([scope]) => scope)).toEqual([
      { origin: "https://other.test", namespace: "eip155" },
    ]);

    second.disconnect();
    expect(core.closeConnection.mock.calls.map(([scope]) => scope)).toEqual([
      { origin: "https://other.test", namespace: "eip155" },
      { origin: "https://example.test", namespace: "eip155" },
    ]);
  });

  it("does not expose unexpected core errors to the page", async () => {
    const core = createDappConnections();
    const host = createDappTransportHost({ dappConnections: core.api });
    const page = createTestChannel();
    host.attach({ channel: page.channel, origin: "https://example.test" });
    page.receive({ type: "open", namespace: "eip155" });
    page.sent.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failures = [
      new Error("private unexpected detail", { cause: new Error("private cause") }),
      new PersistenceCommitError(new Error("private persistence cause")),
    ];

    const expected: WalletToPageMessage[] = [];
    for (const [index, failure] of failures.entries()) {
      core.request.mockRejectedValueOnce(failure);
      const id = index + 1;
      page.receive({
        type: "request",
        namespace: "eip155",
        id,
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
      expected.push({
        type: "failure",
        namespace: "eip155",
        id,
        error: { kind: "internal", message: "Internal error." },
      });
      await vi.waitFor(() => expect(page.sent).toEqual(expected));
    }
    page.disconnect();
  });
});
