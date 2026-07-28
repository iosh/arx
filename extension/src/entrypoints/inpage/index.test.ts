// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

const {
  announceEip6963ProviderMock,
  createEip155ProviderMock,
  createInpageProviderChannelMock,
  setEthereumProviderIfAbsentMock,
} = vi.hoisted(() => ({
  announceEip6963ProviderMock: vi.fn(),
  createEip155ProviderMock: vi.fn(),
  createInpageProviderChannelMock: vi.fn(),
  setEthereumProviderIfAbsentMock: vi.fn(),
}));

vi.mock("@arx/provider/eip155", () => ({
  announceEip6963Provider: announceEip6963ProviderMock,
  createEip155Provider: createEip155ProviderMock,
  setEthereumProviderIfAbsent: setEthereumProviderIfAbsentMock,
}));

vi.mock("@/channels/inpageProviderChannel", () => ({
  createInpageProviderChannel: createInpageProviderChannelMock,
}));

vi.mock("wxt/utils/define-unlisted-script", () => ({
  defineUnlistedScript: (entrypoint: () => void) => entrypoint,
}));

describe("inpage entrypoint", () => {
  it("statically creates, announces, and conditionally injects the EIP-155 provider", async () => {
    const channel = { name: "window channel" };
    const provider = { name: "provider" };
    createInpageProviderChannelMock.mockReturnValue(channel);
    createEip155ProviderMock.mockReturnValue(provider);

    const entrypoint = await import("./index");
    const runEntrypoint = entrypoint.default as unknown as () => void;
    runEntrypoint();

    expect(createInpageProviderChannelMock).toHaveBeenCalledWith({ targetWindow: window });
    expect(createEip155ProviderMock).toHaveBeenCalledWith({ channel });
    expect(announceEip6963ProviderMock).toHaveBeenCalledWith({
      targetWindow: window,
      provider,
      info: {
        uuid: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u),
        name: "ARX Wallet",
        icon: expect.stringMatching(/^data:image\//u),
        rdns: "com.arx.wallet",
      },
    });
    expect(setEthereumProviderIfAbsentMock).toHaveBeenCalledWith({ targetWindow: window, provider });
    expect(announceEip6963ProviderMock.mock.invocationCallOrder[0]).toBeLessThan(
      setEthereumProviderIfAbsentMock.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
