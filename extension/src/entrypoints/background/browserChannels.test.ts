import { describe, expect, it, vi } from "vitest";
import type { Runtime } from "webextension-polyfill";
import { DAPP_PROVIDER_PORT_NAME, WALLET_UI_PORT_NAME } from "@/platform/browser/runtimePortNames";
import { attachBrowserPort, readDappOrigin } from "./browserChannels";

const createPort = (input: Readonly<{ name: string; sender?: Runtime.MessageSender }>) => {
  const port = {
    name: input.name,
    sender: input.sender,
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onDisconnect: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  };

  return port as unknown as Runtime.Port;
};

const createHosts = () => ({
  wallet: { attach: vi.fn() },
  dapp: { attach: vi.fn() },
});

const attach = (port: Runtime.Port, hosts = createHosts()) => ({
  attached: attachBrowserPort({
    port,
    extensionUrl: "chrome-extension://arx/",
    runtimeId: "arx",
    hosts,
  }),
  hosts,
});

describe("background browser channels", () => {
  it("derives a canonical dapp origin from the real frame sender URL", () => {
    const port = createPort({
      name: DAPP_PROVIDER_PORT_NAME,
      sender: {
        id: "arx",
        url: "https://Frame.Example:443/path?query=1",
        tab: { url: "https://top-level.example" } as Runtime.MessageSender["tab"],
      },
    });
    const { attached, hosts } = attach(port);

    expect(attached).toBe(true);
    expect(readDappOrigin(port)).toBe("https://frame.example");
    expect(hosts.dapp.attach).toHaveBeenCalledWith({
      channel: expect.objectContaining({
        send: expect.any(Function),
        onMessage: expect.any(Function),
        onDisconnect: expect.any(Function),
      }),
      origin: "https://frame.example",
    });
    expect(hosts.wallet.attach).not.toHaveBeenCalled();
  });

  it("rejects provider ports without trusted HTTP(S) sender metadata instead of using tab.url", () => {
    const cases: Array<Runtime.MessageSender | undefined> = [
      undefined,
      { id: "other", url: "https://dapp.test" },
      { id: "arx", tab: { url: "https://top-level.example" } as Runtime.MessageSender["tab"] },
      { id: "arx", url: "file:///tmp/dapp.html" },
      { id: "arx", url: "chrome-extension://arx/popup.html" },
      { id: "arx", url: "not a url" },
    ];

    for (const sender of cases) {
      const port = createPort({ name: DAPP_PROVIDER_PORT_NAME, sender });
      const { attached, hosts } = attach(port);

      expect(attached).toBe(false);
      expect(hosts.dapp.attach).not.toHaveBeenCalled();
      expect(port.disconnect).toHaveBeenCalledOnce();
    }
  });

  it("only attaches Wallet UI ports from this extension's real sender URL", () => {
    const validPort = createPort({
      name: WALLET_UI_PORT_NAME,
      sender: { id: "arx", url: "chrome-extension://arx/popup.html" },
    });
    const valid = attach(validPort);

    expect(valid.attached).toBe(true);
    expect(valid.hosts.wallet.attach).toHaveBeenCalledWith(
      expect.objectContaining({
        send: expect.any(Function),
        onMessage: expect.any(Function),
        onDisconnect: expect.any(Function),
      }),
    );

    const untrustedPorts = [
      createPort({ name: WALLET_UI_PORT_NAME, sender: { id: "other", url: "chrome-extension://arx/popup.html" } }),
      createPort({ name: WALLET_UI_PORT_NAME, sender: { id: "arx", url: "https://dapp.test" } }),
      createPort({ name: WALLET_UI_PORT_NAME }),
    ];

    for (const port of untrustedPorts) {
      const rejected = attach(port);
      expect(rejected.attached).toBe(false);
      expect(rejected.hosts.wallet.attach).not.toHaveBeenCalled();
      expect(port.disconnect).toHaveBeenCalledOnce();
    }
  });
});
