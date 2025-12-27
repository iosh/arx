import { ArxReasons, type NamespaceProtocolAdapter } from "@arx/errors";
import { describe, expect, it } from "vitest";
import { getNamespaceProtocolAdapter, registerNamespaceProtocolAdapter } from "./protocolAdapterRegistry.js";

const makeAdapter = (id: string): NamespaceProtocolAdapter => ({
  encodeDappError: () => ({ code: -32603, message: `adapter:${id}` }),
  encodeUiError: () => ({ reason: ArxReasons.RpcInternal, message: `adapter:${id}` }),
});

describe("protocolAdapterRegistry", () => {
  it("throws on empty namespace", () => {
    expect(() => getNamespaceProtocolAdapter("")).toThrow(/non-empty "namespace"/);
    expect(() => registerNamespaceProtocolAdapter("", makeAdapter("x"))).toThrow(/non-empty "namespace"/);
  });

  it("throws when namespace is not registered", () => {
    expect(() => getNamespaceProtocolAdapter("__unregistered__")).toThrow(/not registered/);
  });

  it("falls back from CAIP-2 to prefix namespace", () => {
    const base = "__registry_test_eip155__";
    const adapter = makeAdapter("eip155");
    registerNamespaceProtocolAdapter(base, adapter);
    expect(getNamespaceProtocolAdapter(`${base}:1`)).toBe(adapter);
  });

  it("overwrites adapters when registering the same namespace", () => {
    const ns = "__registry_test_overwrite__";
    const a1 = makeAdapter("1");
    const a2 = makeAdapter("2");
    registerNamespaceProtocolAdapter(ns, a1);
    registerNamespaceProtocolAdapter(ns, a2);
    expect(getNamespaceProtocolAdapter(ns)).toBe(a2);
  });
});
