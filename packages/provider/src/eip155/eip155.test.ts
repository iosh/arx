import type { DuplexChannel } from "@arx/message-channel";
import { describe, expect, it, vi } from "vitest";
import { ProviderRpcError } from "./errors.js";
import {
  announceEip6963Provider,
  type Eip155ProviderWindow,
  type Eip6963ProviderDetail,
  setEthereumProviderIfAbsent,
} from "./inpage.js";
import { createEip155Provider } from "./provider.js";

const createTestChannel = () => {
  const messageListeners = new Set<(message: unknown) => void>();
  const disconnectListeners = new Set<() => void>();
  let failNextSend = false;
  const send = vi.fn<(message: unknown) => void>(() => {
    if (!failNextSend) return;
    failNextSend = false;
    throw new Error("send failed");
  });
  const channel: DuplexChannel = {
    send,
    onMessage: (listener) => {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onDisconnect: (listener) => {
      disconnectListeners.add(listener);
      return () => disconnectListeners.delete(listener);
    },
  };

  return {
    channel,
    send,
    receive: (message: unknown) => {
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

const open = (
  receive: (message: unknown) => void,
  connection: Readonly<{ chainRef: string; accounts: readonly string[] }> = {
    chainRef: "eip155:1",
    accounts: [],
  },
): void => {
  receive({ type: "opened", namespace: "eip155", connection });
};

const createTestWindow = (): Eip155ProviderWindow => {
  return Object.assign(new EventTarget(), { Event, CustomEvent }) as Eip155ProviderWindow;
};

describe("EIP-155 provider", () => {
  it("opens immediately and releases queued requests after the initial connection", async () => {
    const transport = createTestChannel();
    const provider = createEip155Provider({ channel: transport.channel });
    const sendCountsAtConnect: number[] = [];
    const statesAtConnect: unknown[] = [];
    const connected = vi.fn(() => {
      sendCountsAtConnect.push(transport.send.mock.calls.length);
      statesAtConnect.push({
        connected: provider.isConnected(),
        chainId: provider.chainId,
        selectedAddress: provider.selectedAddress,
      });
    });
    provider.on("connect", connected);

    expect(transport.send).toHaveBeenCalledWith({ type: "open", namespace: "eip155" });
    expect(provider.isConnected()).toBe(false);
    expect(provider.chainId).toBeNull();
    expect(provider.selectedAddress).toBeNull();

    const detachedRequest = provider.request;
    const chainIdRequest = detachedRequest<string>({ method: "eth_chainId" });
    expect(transport.send).toHaveBeenCalledTimes(1);

    open(transport.receive, { chainRef: "eip155:10", accounts: ["0xabc"] });
    expect(provider.isConnected()).toBe(true);
    expect(provider.chainId).toBe("0xa");
    expect(provider.selectedAddress).toBe("0xabc");
    expect(connected).toHaveBeenCalledWith({ chainId: "0xa" });
    expect(sendCountsAtConnect).toEqual([1]);
    expect(statesAtConnect).toEqual([{ connected: true, chainId: "0xa", selectedAddress: "0xabc" }]);
    expect(transport.send).toHaveBeenLastCalledWith({
      type: "request",
      namespace: "eip155",
      id: 1,
      method: "eth_chainId",
    });

    open(transport.receive, { chainRef: "eip155:10", accounts: ["0xabc"] });
    expect(connected).toHaveBeenCalledOnce();

    transport.receive({ type: "success", namespace: "eip155", id: 1, result: "0xa" });
    await expect(chainIdRequest).resolves.toBe("0xa");
  });

  it("updates getters before ordered change events and isolates page listeners", () => {
    const transport = createTestChannel();
    const provider = createEip155Provider({ channel: transport.channel });
    open(transport.receive);

    const eventOrder: string[] = [];
    const observedStates: unknown[] = [];
    const accountListener = vi.fn((accounts: unknown) => {
      eventOrder.push("accounts");
      observedStates.push({
        event: "accounts",
        value: accounts,
        chainId: provider.chainId,
        selectedAddress: provider.selectedAddress,
      });
    });

    expect(
      provider
        .on("chainChanged", (chainId) => {
          eventOrder.push("chain");
          observedStates.push({
            event: "chain",
            value: chainId,
            chainId: provider.chainId,
            selectedAddress: provider.selectedAddress,
          });
        })
        .on("accountsChanged", () => {
          eventOrder.push("throwing account listener");
          throw new Error("page listener failed");
        })
        .on("accountsChanged", accountListener),
    ).toBe(provider);

    transport.receive({
      type: "connection_changed",
      namespace: "eip155",
      connection: { chainRef: "eip155:10", accounts: ["0xdef"] },
    });

    expect(eventOrder).toEqual(["chain", "throwing account listener", "accounts"]);
    expect(observedStates).toEqual([
      { event: "chain", value: "0xa", chainId: "0xa", selectedAddress: "0xdef" },
      { event: "accounts", value: ["0xdef"], chainId: "0xa", selectedAddress: "0xdef" },
    ]);
    expect(provider.removeListener("accountsChanged", accountListener)).toBe(provider);

    transport.receive({
      type: "connection_changed",
      namespace: "eip155",
      connection: { chainRef: "eip155:10", accounts: [] },
    });
    expect(accountListener).toHaveBeenCalledTimes(1);
    expect(provider.selectedAddress).toBeNull();

    const chainChanged = vi.fn();
    const accountsChanged = vi.fn();
    provider.on("chainChanged", chainChanged).on("accountsChanged", accountsChanged);
    transport.receive({
      type: "connection_changed",
      namespace: "eip155",
      connection: { chainRef: "eip155:10", accounts: [] },
    });
    expect(chainChanged).not.toHaveBeenCalled();
    expect(accountsChanged).not.toHaveBeenCalled();

    transport.receive({
      type: "connection_changed",
      namespace: "eip155",
      connection: { chainRef: "eip155:10", accounts: ["0xaaa", "0xbbb"] },
    });
    expect(accountsChanged).toHaveBeenCalledWith(["0xaaa", "0xbbb"]);
    transport.receive({
      type: "connection_changed",
      namespace: "eip155",
      connection: { chainRef: "eip155:10", accounts: ["0xaaa", "0xccc"] },
    });
    expect(accountsChanged).toHaveBeenLastCalledWith(["0xaaa", "0xccc"]);
  });

  it("maps boundary errors, settles disconnects, and accepts a fresh opened state without replay", async () => {
    const transport = createTestChannel();
    const provider = createEip155Provider({ channel: transport.channel });
    const connected = vi.fn();
    const statesAtDisconnect: unknown[] = [];
    const disconnected = vi.fn(() => {
      statesAtDisconnect.push({
        connected: provider.isConnected(),
        chainId: provider.chainId,
        selectedAddress: provider.selectedAddress,
      });
    });
    provider.on("connect", connected).on("disconnect", disconnected);
    open(transport.receive);

    await expect(provider.request({ method: "" })).rejects.toMatchObject({ code: -32600 });

    const unsupported = provider.request({ method: "wallet_missingMethod" }).catch((error: unknown) => error);
    transport.receive({
      type: "failure",
      namespace: "eip155",
      id: 1,
      error: { kind: "unsupported_method", message: "Unsupported method." },
    });
    await expect(unsupported).resolves.toMatchObject({ code: 4200, message: "Unsupported method." });

    const jsonRpcFailure = provider.request({ method: "eth_call", params: [] }).catch((error: unknown) => error);
    transport.receive({
      type: "failure",
      namespace: "eip155",
      id: 2,
      error: {
        kind: "json_rpc_response",
        message: "Execution reverted.",
        data: { code: -32000, data: { reason: "reverted" } },
      },
    });
    await expect(jsonRpcFailure).resolves.toMatchObject({
      code: -32000,
      message: "Execution reverted.",
      data: { reason: "reverted" },
    });

    const unavailable = provider.request({ method: "eth_blockNumber" }).catch((error: unknown) => error);
    transport.receive({
      type: "failure",
      namespace: "eip155",
      id: 3,
      error: { kind: "chain_unavailable", message: "Chain unavailable." },
    });
    await expect(unavailable).resolves.toMatchObject({ code: 4901, message: "Chain unavailable." });
    expect(provider.isConnected()).toBe(true);

    const pending = provider
      .request({ method: "eth_getBalance", params: ["0xabc", "latest"] })
      .catch((error: unknown) => error);
    transport.receive({
      type: "transport_disconnected",
      error: { kind: "disconnected", message: "Connection lost." },
    });

    await expect(pending).resolves.toMatchObject({ code: 4900, message: "Connection lost." });
    expect(provider.isConnected()).toBe(false);
    expect(provider.chainId).toBeNull();
    expect(provider.selectedAddress).toBeNull();
    expect(disconnected).toHaveBeenCalledOnce();
    expect(disconnected.mock.calls[0]?.[0]).toBeInstanceOf(ProviderRpcError);
    expect(disconnected.mock.calls[0]?.[0]).toMatchObject({ code: 4900, message: "Connection lost." });
    expect(statesAtDisconnect).toEqual([{ connected: false, chainId: null, selectedAddress: null }]);

    transport.receive({
      type: "transport_disconnected",
      error: { kind: "disconnected", message: "Repeated disconnect." },
    });
    expect(disconnected).toHaveBeenCalledOnce();

    await expect(provider.request({ method: "eth_chainId" })).rejects.toMatchObject({ code: 4900 });
    expect(transport.send).toHaveBeenCalledTimes(5);

    transport.receive({ type: "success", namespace: "eip155", id: 4, result: "late result" });
    expect(provider.isConnected()).toBe(false);

    const largeChainReference = "99999999999999999999999999999999";
    open(transport.receive, { chainRef: `eip155:${largeChainReference}`, accounts: ["0x123"] });
    expect(provider.isConnected()).toBe(true);
    const largeChainId = `0x${BigInt(largeChainReference).toString(16)}`;
    expect(provider.chainId).toBe(largeChainId);
    expect(connected).toHaveBeenCalledTimes(2);
    expect(transport.send).toHaveBeenCalledTimes(5);

    const recovered = provider.request({ method: "eth_chainId" });
    expect(transport.send).toHaveBeenLastCalledWith({
      type: "request",
      namespace: "eip155",
      id: 5,
      method: "eth_chainId",
    });
    transport.receive({ type: "success", namespace: "eip155", id: 5, result: largeChainId });
    await expect(recovered).resolves.toBe(largeChainId);
  });

  it("settles queued requests when opening fails", async () => {
    const transport = createTestChannel();
    const provider = createEip155Provider({ channel: transport.channel });
    const disconnected = vi.fn();
    provider.on("disconnect", disconnected);
    const first = provider.request({ method: "eth_chainId" }).catch((error: unknown) => error);
    const second = provider.request({ method: "eth_accounts" }).catch((error: unknown) => error);

    transport.receive({
      type: "open_failed",
      namespace: "eip155",
      error: { kind: "internal", message: "Unable to open the provider." },
    });

    await expect(first).resolves.toMatchObject({ code: 4900, message: "Unable to open the provider." });
    await expect(second).resolves.toMatchObject({ code: 4900, message: "Unable to open the provider." });
    expect(disconnected).toHaveBeenCalledOnce();
    expect(transport.send).toHaveBeenCalledOnce();
  });

  it("settles every pending request after send or channel failure", async () => {
    const sendFailure = createTestChannel();
    const sendFailureProvider = createEip155Provider({ channel: sendFailure.channel });
    open(sendFailure.receive);
    const sent = sendFailureProvider.request({ method: "eth_chainId" }).catch((error: unknown) => error);
    sendFailure.rejectNextSend();
    const failedSend = sendFailureProvider.request({ method: "eth_accounts" }).catch((error: unknown) => error);
    await expect(sent).resolves.toMatchObject({ code: 4900 });
    await expect(failedSend).resolves.toMatchObject({ code: 4900 });

    const channelFailure = createTestChannel();
    const channelFailureProvider = createEip155Provider({ channel: channelFailure.channel });
    open(channelFailure.receive);
    const channelPending = channelFailureProvider.request({ method: "eth_chainId" }).catch((error: unknown) => error);
    channelFailure.disconnect();
    await expect(channelPending).resolves.toMatchObject({ code: 4900 });
  });

  it("announces through EIP-6963 and injects window.ethereum only when absent", () => {
    const transport = createTestChannel();
    const provider = createEip155Provider({ channel: transport.channel });
    const targetWindow = createTestWindow();
    const announcements: Eip6963ProviderDetail[] = [];
    const initialized = vi.fn();
    targetWindow.addEventListener("eip6963:announceProvider", (event) => {
      announcements.push((event as CustomEvent<Eip6963ProviderDetail>).detail);
    });
    targetWindow.addEventListener("ethereum#initialized", initialized);

    announceEip6963Provider({
      targetWindow,
      provider,
      info: {
        uuid: "350670db-19fa-4704-a166-e52e178b59d2",
        name: "ARX Wallet",
        icon: "data:image/png;base64,AA==",
        rdns: "com.arx.wallet",
      },
    });
    targetWindow.dispatchEvent(new targetWindow.Event("eip6963:requestProvider"));

    expect(announcements).toHaveLength(2);
    expect(announcements[0]?.provider).toBe(provider);
    expect(announcements[0]?.info.name).toBe("ARX Wallet");
    expect(Object.isFrozen(announcements[0])).toBe(true);
    expect(Object.isFrozen(announcements[0]?.info)).toBe(true);

    expect(setEthereumProviderIfAbsent({ targetWindow, provider })).toBe(true);
    expect(targetWindow.ethereum).toBe(provider);
    expect(initialized).toHaveBeenCalledOnce();
    expect(setEthereumProviderIfAbsent({ targetWindow, provider })).toBe(false);
    expect(initialized).toHaveBeenCalledOnce();

    const existing = { name: "Existing Wallet" };
    const occupiedWindow = Object.assign(createTestWindow(), { ethereum: existing });
    expect(setEthereumProviderIfAbsent({ targetWindow: occupiedWindow, provider })).toBe(false);
    expect(occupiedWindow.ethereum).toBe(existing);
  });
});
