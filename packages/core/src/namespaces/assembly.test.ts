import { describe, expect, it, vi } from "vitest";
import { findRpcMethodDefinition, listRpcNamespaces } from "../rpc/index.js";
import { NamespaceTransactions } from "../transactions/namespace/NamespaceTransactions.js";
import {
  assembleNamespaceStatic,
  buildChainAddressingByNamespaceFromManifests,
  materializeNamespaceRuntime,
} from "./assembly.js";
import { eip155NamespaceManifest } from "./eip155/manifest.js";

describe("namespace assembly", () => {
  it("assembles static namespace runtime from one manifest source", () => {
    const assembly = assembleNamespaceStatic([eip155NamespaceManifest]);

    expect(assembly.manifests[0]).toBe(eip155NamespaceManifest);
    expect(assembly.rpcModules).toEqual([eip155NamespaceManifest.core.rpc]);
    expect(listRpcNamespaces(assembly.rpcRouting)).toEqual(["eip155"]);
    expect(findRpcMethodDefinition(assembly.rpcRouting, "eip155", "eth_chainId")).toBeDefined();
    expect(assembly.rpcClientFactories).toEqual([
      {
        namespace: "eip155",
        factory: eip155NamespaceManifest.runtime.clientFactory,
      },
    ]);
    expect(assembly.accountAddressing.eip155).toBe(eip155NamespaceManifest.core.accountAddressing);
    expect(assembly.chainAddressing.eip155).toBe(eip155NamespaceManifest.core.chainAddressing);
    expect(assembly.chainSeeds).toEqual(eip155NamespaceManifest.core.chainSeeds);
    expect(assembly.chainSeeds[0]).toBe(eip155NamespaceManifest.core.chainSeeds?.[0]);

    expect(eip155NamespaceManifest.core.keyringAdapter.namespace).toBe("eip155");
  });

  it("prefers overridden namespace transactions when materializing runtime bindings", () => {
    const createTransaction = vi.fn(() => {
      throw new Error("manifest transaction should not be constructed");
    });
    const manifest = {
      ...eip155NamespaceManifest,
      runtime: {
        ...eip155NamespaceManifest.runtime,
        createTransaction,
      },
    };
    const overriddenTransaction = {
      proposal: {
        prepare: async () => ({ status: "ready" as const, prepared: {} }),
        buildReplacementRequest: async (context) => context.targetRequest,
      },
    };

    const materialized = materializeNamespaceRuntime({
      manifests: [manifest],
      rpcClients: {
        getClient: () => undefined,
      },
      chains: buildChainAddressingByNamespaceFromManifests([manifest]),
      accountSigning: {} as never,
      transactionOverrides: new NamespaceTransactions([["eip155", overriddenTransaction]]),
    });

    expect(createTransaction).not.toHaveBeenCalled();
    expect(materialized.namespaceTransactions.require("eip155")).toBe(overriddenTransaction);
    expect(materialized.services.approvals.signMessage).toEqual(expect.any(Function));
    expect(materialized.services.ui.getNativeBalance).toEqual(expect.any(Function));
  });
});
