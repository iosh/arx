import { describe, expect, it, vi } from "vitest";
import { ChainModuleRegistry, createDefaultChainModuleRegistry } from "./registry.js";
import type { ChainDescriptor } from "./types.js";

describe("ChainModuleRegistry", () => {
  it("normalizes address via registered descriptor", () => {
    const registry = createDefaultChainModuleRegistry();

    const normalized = registry.normalizeAddress({
      chainRef: "eip155:1",
      value: "0xAaBbCcDdEeFf00112233445566778899AaBbCcDd",
    });

    expect(normalized.canonical).toBe("0xaabbccddeeff00112233445566778899aabbccdd");
  });

  it("formats and validates addresses", () => {
    const registry = createDefaultChainModuleRegistry();

    const formatted = registry.formatAddress({
      chainRef: "eip155:1",
      canonical: "0xde709f2102306220921060314715629080e2fb77",
    });

    expect(formatted).toBe("0xde709f2102306220921060314715629080e2fb77");
    expect(() =>
      registry.validateAddress({
        chainRef: "eip155:1",
        canonical: "0xde709f2102306220921060314715629080e2fb77",
      }),
    ).not.toThrow();
  });

  it("allows registering custom descriptor", () => {
    const descriptor: ChainDescriptor<{ note: string }> = {
      namespace: "demo",
      supportsChain: (chainRef) => chainRef === "demo:1",
      address: {
        normalize: vi.fn().mockReturnValue({ canonical: "canonical-value", metadata: { note: "normalized" } }),
        format: vi.fn().mockReturnValue("formatted-value"),
        validate: vi.fn(),
      },
    };

    const registry = new ChainModuleRegistry();
    registry.registerDescriptor(descriptor);

    const normalized = registry.normalizeAddress({ chainRef: "demo:1", value: "input" });
    expect(normalized).toEqual({ canonical: "canonical-value", metadata: { note: "normalized" } });

    const formatted = registry.formatAddress({ chainRef: "demo:1", canonical: "canonical-value" });
    expect(formatted).toBe("formatted-value");

    expect(() => registry.validateAddress({ chainRef: "demo:1", canonical: "canonical-value" })).not.toThrow();

    expect(descriptor.address.normalize).toHaveBeenCalledWith({ chainRef: "demo:1", value: "input" });
    expect(descriptor.address.format).toHaveBeenCalledWith({ chainRef: "demo:1", canonical: "canonical-value" });
    expect(descriptor.address.validate).toHaveBeenCalledWith({ chainRef: "demo:1", canonical: "canonical-value" });
  });

  it("throws when chain descriptor is missing", () => {
    const registry = createDefaultChainModuleRegistry();

    expect(() =>
      registry.normalizeAddress({
        chainRef: "solana:mainnet",
        value: "0x0000000000000000000000000000000000000000",
      }),
    ).toThrow(/No chain descriptor registered/);
  });
});
