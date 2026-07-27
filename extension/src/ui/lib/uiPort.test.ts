import { describe, expect, it, vi } from "vitest";
import type browser from "webextension-polyfill";
import { WALLET_UI_PORT_NAME } from "@/platform/browser/runtimePortNames";
import { createWalletUiChannel } from "./uiPort";

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      connect: vi.fn(),
    },
  },
}));

const createPort = () => ({
  postMessage: vi.fn(),
  onMessage: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  onDisconnect: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
});

describe("createWalletUiChannel", () => {
  it("creates one established channel without a ready handshake or reconnect loop", () => {
    const port = createPort();
    const runtime = {
      connect: vi.fn(() => port),
    };
    const channel = createWalletUiChannel({ browser: { runtime } as unknown as Pick<typeof browser, "runtime"> });
    const disconnected = vi.fn();

    channel.onDisconnect(disconnected);
    channel.send({ type: "request", id: 1, method: "getStatus" });

    expect(runtime.connect).toHaveBeenCalledOnce();
    expect(runtime.connect).toHaveBeenCalledWith({ name: WALLET_UI_PORT_NAME });
    expect(port.postMessage).toHaveBeenCalledWith({ type: "request", id: 1, method: "getStatus" });
    expect(port.onDisconnect.addListener).toHaveBeenCalledOnce();

    const onDisconnect = port.onDisconnect.addListener.mock.calls[0]?.[0];
    onDisconnect?.();

    expect(disconnected).toHaveBeenCalledOnce();
    expect(runtime.connect).toHaveBeenCalledOnce();
  });
});
