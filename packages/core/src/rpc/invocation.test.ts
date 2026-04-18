import { ArxReasons } from "@arx/errors";
import { describe, expect, it } from "vitest";
import type { HandlerControllers, RpcInvocationContext } from "./handlers/types.js";
import { resolveRpcInvocation } from "./invocation.js";
import { RpcRegistry } from "./RpcRegistry.js";

const makeControllers = (activeChainByNamespace?: Record<string, string>): HandlerControllers => {
  return {
    network: {} as never,
    networkSelection: {
      getSelectedChainRef: (namespace: string) => activeChainByNamespace?.[namespace] ?? null,
    },
  } as unknown as HandlerControllers;
};

const getErrorReason = (error: unknown) => {
  return typeof error === "object" && error !== null && "reason" in error
    ? (error as { reason?: unknown }).reason
    : null;
};

describe("resolveRpcInvocation", () => {
  it("fails when namespace cannot be inferred from context or method prefix", () => {
    const registry = new RpcRegistry();
    registry.registerNamespaceAdapter({ namespace: "eip155", methodPrefixes: ["eth_"], definitions: {} });

    const controllers = makeControllers(undefined);

    try {
      resolveRpcInvocation(registry, controllers, "custom_ping", undefined);
      throw new Error("Expected resolveRpcInvocation to throw");
    } catch (error) {
      expect(getErrorReason(error)).toBe(ArxReasons.RpcInvalidRequest);
      expect((error as Error).message).toMatch(/Missing namespace context/);
    }
  });

  it("does not fall back to the global active chain when chainRef is absent", () => {
    const registry = new RpcRegistry();
    registry.registerNamespaceAdapter({ namespace: "eip155", methodPrefixes: ["eth_"], definitions: {} });

    const controllers = makeControllers(undefined);

    expect(() => resolveRpcInvocation(registry, controllers, "eth_chainId", undefined)).toThrow(/Missing chainRef/);
  });

  it("falls back to the namespace-specific active chain when chainRef is absent", () => {
    const registry = new RpcRegistry();
    registry.registerNamespaceAdapter({ namespace: "eip155", methodPrefixes: ["eth_"], definitions: {} });
    registry.registerNamespaceAdapter({ namespace: "solana", methodPrefixes: ["sol_"], definitions: {} });

    const controllers = makeControllers({ eip155: "eip155:10", solana: "solana:101" });
    expect(resolveRpcInvocation(registry, controllers, "eth_chainId", undefined)).toEqual({
      namespace: "eip155",
      chainRef: "eip155:10",
    });
  });

  it("uses provided chainRef when present and infers namespace from its prefix", () => {
    const registry = new RpcRegistry();
    registry.registerNamespaceAdapter({ namespace: "eip155", methodPrefixes: ["eth_"], definitions: {} });
    const controllers = makeControllers(undefined);

    expect(resolveRpcInvocation(registry, controllers, "eth_chainId", { chainRef: "eip155:137" })).toEqual({
      namespace: "eip155",
      chainRef: "eip155:137",
    });
  });

  it("uses provider binding when namespace cannot be inferred from explicit context or method prefix", () => {
    const registry = new RpcRegistry();
    registry.registerNamespaceAdapter({ namespace: "eip155", methodPrefixes: ["eth_"], definitions: {} });
    registry.registerNamespaceAdapter({ namespace: "conflux", methodPrefixes: ["cfx_"], definitions: {} });

    const controllers = makeControllers({ eip155: "eip155:10", conflux: "conflux:1029" });

    expect(resolveRpcInvocation(registry, controllers, "custom_ping", { providerNamespace: "conflux" })).toEqual({
      namespace: "conflux",
      chainRef: "conflux:1029",
    });
  });

  it("keeps method-prefix resolution ahead of provider binding", () => {
    const registry = new RpcRegistry();
    registry.registerNamespaceAdapter({ namespace: "eip155", methodPrefixes: ["eth_"], definitions: {} });
    registry.registerNamespaceAdapter({ namespace: "conflux", methodPrefixes: ["cfx_"], definitions: {} });

    const controllers = makeControllers({ eip155: "eip155:10", conflux: "conflux:1029" });

    expect(resolveRpcInvocation(registry, controllers, "eth_chainId", { providerNamespace: "conflux" })).toEqual({
      namespace: "eip155",
      chainRef: "eip155:10",
    });
  });

  it("rejects mismatched context namespace vs chainRef prefix", () => {
    const registry = new RpcRegistry();
    registry.registerNamespaceAdapter({ namespace: "eip155", methodPrefixes: ["eth_"], definitions: {} });
    registry.registerNamespaceAdapter({ namespace: "conflux", methodPrefixes: ["cfx_"], definitions: {} });

    const controllers = makeControllers(undefined);
    const context: RpcInvocationContext = { namespace: "eip155", chainRef: "conflux:cfx" };
    try {
      resolveRpcInvocation(registry, controllers, "eth_chainId", context);
      throw new Error("Expected resolveRpcInvocation to throw");
    } catch (error) {
      expect(getErrorReason(error)).toBe(ArxReasons.RpcInvalidRequest);
    }
  });

  it("rejects mismatched provider binding vs explicit namespace", () => {
    const registry = new RpcRegistry();
    registry.registerNamespaceAdapter({ namespace: "eip155", methodPrefixes: ["eth_"], definitions: {} });
    registry.registerNamespaceAdapter({ namespace: "conflux", methodPrefixes: ["cfx_"], definitions: {} });

    const controllers = makeControllers({ eip155: "eip155:1", conflux: "conflux:1029" });
    const context: RpcInvocationContext = { namespace: "eip155", providerNamespace: "conflux" };

    expect(() => resolveRpcInvocation(registry, controllers, "eth_chainId", context)).toThrow(/providerNamespace/);
  });

  it("rejects mismatched provider binding vs chainRef prefix", () => {
    const registry = new RpcRegistry();
    registry.registerNamespaceAdapter({ namespace: "eip155", methodPrefixes: ["eth_"], definitions: {} });
    registry.registerNamespaceAdapter({ namespace: "conflux", methodPrefixes: ["cfx_"], definitions: {} });

    const controllers = makeControllers({ eip155: "eip155:1", conflux: "conflux:1029" });
    const context: RpcInvocationContext = { providerNamespace: "conflux", chainRef: "eip155:1" };

    expect(() => resolveRpcInvocation(registry, controllers, "custom_ping", context)).toThrow(/providerNamespace/);
  });

  it("rejects invalid chainRef identifiers", () => {
    const registry = new RpcRegistry();
    registry.registerNamespaceAdapter({ namespace: "eip155", methodPrefixes: ["eth_"], definitions: {} });
    const controllers = makeControllers(undefined);

    expect(() => resolveRpcInvocation(registry, controllers, "eth_chainId", { chainRef: "eip155" })).toThrow(
      /Invalid chainRef/,
    );
  });
});
