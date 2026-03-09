import { ArxReasons } from "@arx/errors";
import { describe, expect, it } from "vitest";
import type { HandlerControllers, RpcInvocationContext } from "./handlers/types.js";
import { RpcRegistry } from "./RpcRegistry.js";

const makeControllers = (
  activeChainByNamespace?: Record<string, string>,
  legacyActiveChainRef = "eip155:1",
): HandlerControllers => {
  return {
    network: {
      getState: () => ({ activeChainRef: legacyActiveChainRef }),
    },
    networkPreferences: {
      getActiveChainRef: (namespace: string) => activeChainByNamespace?.[namespace] ?? null,
    },
  } as unknown as HandlerControllers;
};

const getReason = (error: unknown) => {
  return typeof error === "object" && error !== null && "reason" in error
    ? (error as { reason?: unknown }).reason
    : null;
};

describe("RpcRegistry.resolveInvocation", () => {
  it("fails when namespace cannot be inferred from context or method prefix", () => {
    const registry = new RpcRegistry();
    registry.registerNamespaceAdapter({ namespace: "eip155", methodPrefixes: ["eth_"], definitions: {} });

    const controllers = makeControllers(undefined, "solana:101");

    try {
      registry.resolveInvocation(controllers, "custom_ping", undefined);
      throw new Error("Expected resolveInvocation to throw");
    } catch (error) {
      expect(getReason(error)).toBe(ArxReasons.RpcInvalidRequest);
      expect((error as Error).message).toMatch(/Missing namespace context/);
    }
  });

  it("does not fall back to the global active chain when chainRef is absent", () => {
    const registry = new RpcRegistry();
    registry.registerNamespaceAdapter({ namespace: "eip155", methodPrefixes: ["eth_"], definitions: {} });

    const controllers = makeControllers(undefined, "eip155:1");

    expect(() => registry.resolveInvocation(controllers, "eth_chainId", undefined)).toThrow(/Missing chainRef/);
  });

  it("falls back to the namespace-specific active chain when chainRef is absent", () => {
    const registry = new RpcRegistry();
    registry.registerNamespaceAdapter({ namespace: "eip155", methodPrefixes: ["eth_"], definitions: {} });
    registry.registerNamespaceAdapter({ namespace: "solana", methodPrefixes: ["sol_"], definitions: {} });

    const controllers = makeControllers({ eip155: "eip155:10", solana: "solana:101" }, "solana:101");
    expect(registry.resolveInvocation(controllers, "eth_chainId", undefined)).toEqual({
      namespace: "eip155",
      chainRef: "eip155:10",
    });
  });

  it("uses provided chainRef when present and infers namespace from its prefix", () => {
    const registry = new RpcRegistry();
    registry.registerNamespaceAdapter({ namespace: "eip155", methodPrefixes: ["eth_"], definitions: {} });
    const controllers = makeControllers(undefined, "solana:101");

    expect(registry.resolveInvocation(controllers, "eth_chainId", { chainRef: "eip155:137" })).toEqual({
      namespace: "eip155",
      chainRef: "eip155:137",
    });
  });

  it("rejects mismatched context namespace vs chainRef prefix", () => {
    const registry = new RpcRegistry();
    registry.registerNamespaceAdapter({ namespace: "eip155", methodPrefixes: ["eth_"], definitions: {} });
    registry.registerNamespaceAdapter({ namespace: "conflux", methodPrefixes: ["cfx_"], definitions: {} });

    const controllers = makeControllers(undefined, "eip155:1");
    const ctx: RpcInvocationContext = { namespace: "eip155", chainRef: "conflux:cfx" };
    try {
      registry.resolveInvocation(controllers, "eth_chainId", ctx);
      throw new Error("Expected resolveInvocation to throw");
    } catch (error) {
      expect(getReason(error)).toBe(ArxReasons.RpcInvalidRequest);
    }
  });

  it("rejects invalid chainRef identifiers", () => {
    const registry = new RpcRegistry();
    registry.registerNamespaceAdapter({ namespace: "eip155", methodPrefixes: ["eth_"], definitions: {} });
    const controllers = makeControllers(undefined, "eip155:1");

    expect(() => registry.resolveInvocation(controllers, "eth_chainId", { chainRef: "eip155" })).toThrow(
      /Invalid chainRef/,
    );
  });
});
