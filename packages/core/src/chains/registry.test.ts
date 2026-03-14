import { describe, expect, it, vi } from "vitest";
import { eip155AddressCodec } from "./eip155/addressCodec.js";
import { ChainAddressCodecRegistry } from "./registry.js";
import type { ChainAddressCodec } from "./types.js";

const createTestRegistry = () => new ChainAddressCodecRegistry([eip155AddressCodec]);

describe("ChainAddressCodecRegistry", () => {
  it("normalizes address via registered codec", () => {
    const registry = createTestRegistry();

    const normalized = registry.toCanonicalAddress({
      chainRef: "eip155:1",
      value: "0xAaBbCcDdEeFf00112233445566778899AaBbCcDd",
    });

    expect(normalized.canonical).toBe("0xaabbccddeeff00112233445566778899aabbccdd");
  });

  it("formats and validates addresses", () => {
    const registry = createTestRegistry();

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

  it("allows registering custom codec", () => {
    const codec: ChainAddressCodec<{ note: string }> = {
      namespace: "demo",
      address: {
        canonicalize: vi.fn().mockReturnValue({ canonical: "canonical-value", metadata: { note: "normalized" } }),
        format: vi.fn().mockReturnValue("formatted-value"),
        validate: vi.fn(),
      },
    };

    const registry = new ChainAddressCodecRegistry();
    registry.registerCodec(codec);

    const normalized = registry.toCanonicalAddress({ chainRef: "demo:1", value: "input" });
    expect(normalized).toEqual({ canonical: "canonical-value", metadata: { note: "normalized" } });

    const formatted = registry.formatAddress({ chainRef: "demo:1", canonical: "canonical-value" });
    expect(formatted).toBe("formatted-value");

    expect(() => registry.validateAddress({ chainRef: "demo:1", canonical: "canonical-value" })).not.toThrow();

    expect(codec.address.canonicalize).toHaveBeenCalledWith({ chainRef: "demo:1", value: "input" });
    expect(codec.address.format).toHaveBeenCalledWith({ chainRef: "demo:1", canonical: "canonical-value" });
    expect(codec.address.validate).toHaveBeenCalledWith({ chainRef: "demo:1", canonical: "canonical-value" });
  });

  it("throws when chain address codec is missing", () => {
    const registry = createTestRegistry();

    expect(() =>
      registry.toCanonicalAddress({
        chainRef: "solana:mainnet",
        value: "0x0000000000000000000000000000000000000000",
      }),
    ).toThrow(/No chain address codec registered/);
  });
});
