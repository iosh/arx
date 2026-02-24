import { ArxReasons } from "@arx/errors";
import { describe, expect, it } from "vitest";
import type { HandlerControllers, RpcInvocationContext } from "./handlers/types.js";
import { RpcRegistry } from "./RpcRegistry.js";

const makeControllers = (activeChainRef: string): HandlerControllers => {
  return {
    network: {
      getActiveChain: () => ({ chainRef: activeChainRef }),
    },
  } as unknown as HandlerControllers;
};

const getReason = (error: unknown) => {
  return typeof error === "object" && error !== null && "reason" in error
    ? (error as { reason?: unknown }).reason
    : null;
};

describe("RpcRegistry.resolveInvocation", () => {
  it("falls back to activeChainRef when namespace matches and chainRef is absent", () => {
    const registry = new RpcRegistry();
    registry.registerNamespaceAdapter({ namespace: "eip155", methodPrefixes: ["eth_"], definitions: {} });

    const controllers = makeControllers("eip155:1");
    expect(registry.resolveInvocation(controllers, "eth_chainId", undefined)).toEqual({
      namespace: "eip155",
      chainRef: "eip155:1",
    });
  });

  it("requires chainRef when inferred namespace does not match active chain namespace", () => {
    const registry = new RpcRegistry();
    registry.registerNamespaceAdapter({ namespace: "eip155", methodPrefixes: ["eth_"], definitions: {} });
    registry.registerNamespaceAdapter({ namespace: "conflux", methodPrefixes: ["cfx_"], definitions: {} });

    const controllers = makeControllers("eip155:1");
    expect(() => registry.resolveInvocation(controllers, "cfx_getStatus", undefined)).toThrow(/Missing chainRef/);
  });

  it("rejects mismatched context namespace vs chainRef prefix", () => {
    const registry = new RpcRegistry();
    registry.registerNamespaceAdapter({ namespace: "eip155", methodPrefixes: ["eth_"], definitions: {} });
    registry.registerNamespaceAdapter({ namespace: "conflux", methodPrefixes: ["cfx_"], definitions: {} });

    const controllers = makeControllers("eip155:1");
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
    const controllers = makeControllers("eip155:1");

    expect(() => registry.resolveInvocation(controllers, "eth_chainId", { chainRef: "eip155" })).toThrow(
      /Invalid chainRef/,
    );
  });

  it("uses provided chainRef when present and normalizes it", () => {
    const registry = new RpcRegistry();
    registry.registerNamespaceAdapter({ namespace: "eip155", methodPrefixes: ["eth_"], definitions: {} });
    const controllers = makeControllers("eip155:1");

    expect(registry.resolveInvocation(controllers, "eth_chainId", { chainRef: "eip155:137" })).toEqual({
      namespace: "eip155",
      chainRef: "eip155:137",
    });
  });
});
