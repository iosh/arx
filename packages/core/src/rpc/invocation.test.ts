import { describe, expect, it } from "vitest";
import type { RpcHandlerDeps, RpcInvocationHint } from "./handlers/types.js";
import { resolveRpcInvocation } from "./invocation.js";
import { buildRpcRouting } from "./routing.js";

const createTable = (entries: Array<{ namespace: string; methodPrefixes: string[] }>) =>
  buildRpcRouting(
    entries.map((entry) => ({
      namespace: entry.namespace,
      methodPrefixes: entry.methodPrefixes,
      definitions: {},
    })),
  );

const makeRpcHandlerDeps = (activeChainByNamespace?: Record<string, string>): RpcHandlerDeps => {
  return {
    networks: {
      getSelection: () => ({
        selectedChainRefByNamespace: activeChainByNamespace ?? {},
      }),
    },
  } as unknown as RpcHandlerDeps;
};

const getErrorCode = (error: unknown) => {
  return typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : null;
};

describe("resolveRpcInvocation", () => {
  it("fails when namespace cannot be inferred from context or method prefix", () => {
    const table = createTable([{ namespace: "eip155", methodPrefixes: ["eth_"] }]);
    const handlerDeps = makeRpcHandlerDeps(undefined);

    try {
      resolveRpcInvocation(table, handlerDeps, "custom_ping", undefined);
      throw new Error("Expected resolveRpcInvocation to throw");
    } catch (error) {
      expect(getErrorCode(error)).toBe("global.rpc.invalid_request");
      expect((error as Error).message).toMatch(/Missing namespace context/);
    }
  });

  it("does not fall back to the global active chain when chainRef is absent", () => {
    const table = createTable([{ namespace: "eip155", methodPrefixes: ["eth_"] }]);
    const handlerDeps = makeRpcHandlerDeps(undefined);

    expect(() => resolveRpcInvocation(table, handlerDeps, "eth_chainId", undefined)).toThrow(/Missing chainRef/);
  });

  it("falls back to the namespace-specific active chain when chainRef is absent", () => {
    const table = createTable([
      { namespace: "eip155", methodPrefixes: ["eth_"] },
      { namespace: "solana", methodPrefixes: ["sol_"] },
    ]);

    const handlerDeps = makeRpcHandlerDeps({ eip155: "eip155:10", solana: "solana:101" });
    expect(resolveRpcInvocation(table, handlerDeps, "eth_chainId", undefined)).toEqual({
      namespace: "eip155",
      chainRef: "eip155:10",
    });
  });

  it("uses provided chainRef when present and infers namespace from its prefix", () => {
    const table = createTable([{ namespace: "eip155", methodPrefixes: ["eth_"] }]);
    const handlerDeps = makeRpcHandlerDeps(undefined);

    expect(resolveRpcInvocation(table, handlerDeps, "eth_chainId", { chainRef: "eip155:137" })).toEqual({
      namespace: "eip155",
      chainRef: "eip155:137",
    });
  });

  it("uses explicit namespace when method prefix cannot infer it", () => {
    const table = createTable([
      { namespace: "eip155", methodPrefixes: ["eth_"] },
      { namespace: "conflux", methodPrefixes: ["cfx_"] },
    ]);
    const handlerDeps = makeRpcHandlerDeps({ eip155: "eip155:10", conflux: "conflux:1029" });

    expect(resolveRpcInvocation(table, handlerDeps, "custom_ping", { namespace: "conflux" })).toEqual({
      namespace: "conflux",
      chainRef: "conflux:1029",
    });
  });

  it("keeps method-prefix resolution ahead of absent explicit context", () => {
    const table = createTable([
      { namespace: "eip155", methodPrefixes: ["eth_"] },
      { namespace: "conflux", methodPrefixes: ["cfx_"] },
    ]);
    const handlerDeps = makeRpcHandlerDeps({ eip155: "eip155:10", conflux: "conflux:1029" });

    expect(resolveRpcInvocation(table, handlerDeps, "eth_chainId", undefined)).toEqual({
      namespace: "eip155",
      chainRef: "eip155:10",
    });
  });

  it("rejects mismatched context namespace vs chainRef prefix", () => {
    const table = createTable([
      { namespace: "eip155", methodPrefixes: ["eth_"] },
      { namespace: "conflux", methodPrefixes: ["cfx_"] },
    ]);
    const handlerDeps = makeRpcHandlerDeps(undefined);
    const context: RpcInvocationHint = { namespace: "eip155", chainRef: "conflux:cfx" };

    try {
      resolveRpcInvocation(table, handlerDeps, "eth_chainId", context);
      throw new Error("Expected resolveRpcInvocation to throw");
    } catch (error) {
      expect(getErrorCode(error)).toBe("global.rpc.invalid_request");
    }
  });

  it("rejects invalid chainRef identifiers", () => {
    const table = createTable([{ namespace: "eip155", methodPrefixes: ["eth_"] }]);
    const handlerDeps = makeRpcHandlerDeps(undefined);

    expect(() => resolveRpcInvocation(table, handlerDeps, "eth_chainId", { chainRef: "eip155" })).toThrow(
      /Invalid chainRef/,
    );
  });
});
