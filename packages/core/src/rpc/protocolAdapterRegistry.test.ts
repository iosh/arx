import { ArxReasons, type NamespaceProtocolAdapter } from "@arx/errors";
import { describe, expect, it } from "vitest";
import { RpcRegistry } from "./RpcRegistry.js";

const makeAdapter = (id: string): NamespaceProtocolAdapter => ({
  encodeDappError: () => ({ code: -32603, message: `adapter:${id}` }),
  encodeUiError: () => ({ reason: ArxReasons.RpcInternal, message: `adapter:${id}` }),
});

describe("protocolAdapterRegistry", () => {
  it("throws on empty namespace", () => {
    const registry = new RpcRegistry();
    expect(() => registry.getNamespaceProtocolAdapter("")).toThrow(/non-empty "namespace"/);
    expect(() => registry.registerNamespaceProtocolAdapter("", makeAdapter("x"))).toThrow(/non-empty "namespace"/);
  });

  it("throws when namespace is not registered", () => {
    const registry = new RpcRegistry();
    expect(() => registry.getNamespaceProtocolAdapter("__unregistered__")).toThrow(/not registered/);
  });

  it("falls back from CAIP-2 to prefix namespace", () => {
    const registry = new RpcRegistry();
    const base = "__registry_test_eip155__";
    const adapter = makeAdapter("eip155");
    registry.registerNamespaceProtocolAdapter(base, adapter);
    expect(registry.getNamespaceProtocolAdapter(`${base}:1`)).toBe(adapter);
  });

  it("overwrites adapters when registering the same namespace", () => {
    const registry = new RpcRegistry();
    const ns = "__registry_test_overwrite__";
    const a1 = makeAdapter("1");
    const a2 = makeAdapter("2");
    registry.registerNamespaceProtocolAdapter(ns, a1);
    registry.registerNamespaceProtocolAdapter(ns, a2);
    expect(registry.getNamespaceProtocolAdapter(ns)).toBe(a2);
  });
});
