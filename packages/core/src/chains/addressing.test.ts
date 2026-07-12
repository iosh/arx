import { describe, expect, it, vi } from "vitest";
import { eip155ChainAddressing } from "../namespaces/eip155/chainAddressing.js";
import {
  buildChainAddressingByNamespace,
  canonicalizeChainAddress,
  formatChainAddress,
  validateChainAddress,
} from "./addressing.js";
import type { NamespaceChainAddressing } from "./types.js";

const createTestTable = () => buildChainAddressingByNamespace([eip155ChainAddressing]);

describe("ChainAddressingByNamespace", () => {
  it("canonicalizes an eip155 address", () => {
    const table = createTestTable();

    const normalized = canonicalizeChainAddress(table, {
      chainRef: "eip155:1",
      value: "0xAaBbCcDdEeFf00112233445566778899AaBbCcDd",
    });

    expect(normalized.canonical).toBe("0xaabbccddeeff00112233445566778899aabbccdd");
  });

  it("formats and validates addresses", () => {
    const table = createTestTable();

    const formatted = formatChainAddress(table, {
      chainRef: "eip155:1",
      canonical: "0xde709f2102306220921060314715629080e2fb77",
    });

    expect(formatted).toBe("0xde709f2102306220921060314715629080e2fb77");
    expect(() =>
      validateChainAddress(table, {
        chainRef: "eip155:1",
        canonical: "0xde709f2102306220921060314715629080e2fb77",
      }),
    ).not.toThrow();
  });

  it("routes custom namespace addressing by chainRef namespace", () => {
    const addressing: NamespaceChainAddressing<{ note: string }> = {
      namespace: "demo",
      address: {
        canonicalize: vi.fn().mockReturnValue({ canonical: "canonical-value", metadata: { note: "normalized" } }),
        format: vi.fn().mockReturnValue("formatted-value"),
        validate: vi.fn(),
      },
    };

    const table = buildChainAddressingByNamespace([addressing]);

    const normalized = canonicalizeChainAddress(table, { chainRef: "demo:1", value: "input" });
    expect(normalized).toEqual({ canonical: "canonical-value", metadata: { note: "normalized" } });

    const formatted = formatChainAddress(table, { chainRef: "demo:1", canonical: "canonical-value" });
    expect(formatted).toBe("formatted-value");

    expect(() => validateChainAddress(table, { chainRef: "demo:1", canonical: "canonical-value" })).not.toThrow();

    expect(addressing.address.canonicalize).toHaveBeenCalledWith({ chainRef: "demo:1", value: "input" });
    expect(addressing.address.format).toHaveBeenCalledWith({ chainRef: "demo:1", canonical: "canonical-value" });
    expect(addressing.address.validate).toHaveBeenCalledWith({ chainRef: "demo:1", canonical: "canonical-value" });
  });

  it("throws when chain address addressing is missing", () => {
    const table = createTestTable();

    expect(() =>
      canonicalizeChainAddress(table, {
        chainRef: "solana:mainnet",
        value: "0x0000000000000000000000000000000000000000",
      }),
    ).toThrow(/No chain address handling is available/);
  });
});
