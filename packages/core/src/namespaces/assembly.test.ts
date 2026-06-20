import { describe, expect, it, vi } from "vitest";
import { NamespaceTransactions } from "../transactions/namespace/NamespaceTransactions.js";
import {
  assembleRuntimeNamespaceStages,
  createChainAddressCodecRegistryFromManifests,
  materializeNamespaceRuntimeSupport,
} from "./assembly.js";
import { eip155NamespaceManifest } from "./eip155/manifest.js";
import type { NamespaceManifest } from "./types.js";

describe("namespace stage assembly", () => {
  it("assembles bootstrap, session, and runtime support facts from the same manifest source", () => {
    const stages = assembleRuntimeNamespaceStages([eip155NamespaceManifest]);

    expect(stages.bootstrap.rpcModules).toEqual([eip155NamespaceManifest.core.rpc]);
    expect(stages.bootstrap.accountCodecs.require("eip155")).toBe(eip155NamespaceManifest.core.accountCodec);
    expect(stages.bootstrap.chainAddressCodecs.getCodec("eip155:1")).toBe(
      eip155NamespaceManifest.core.chainAddressCodec,
    );
    expect(stages.bootstrap.chainSeeds).toEqual(eip155NamespaceManifest.core.chainSeeds);
    expect(stages.bootstrap.chainSeeds).not.toBe(eip155NamespaceManifest.core.chainSeeds);
    expect(stages.bootstrap.chainSeeds[0]).not.toBe(eip155NamespaceManifest.core.chainSeeds?.[0]);

    expect(stages.session.keyringNamespaces).toHaveLength(1);
    expect(stages.session.keyringNamespaces[0]).toEqual(eip155NamespaceManifest.core.keyring);
    expect(stages.session.keyringNamespaces[0]).not.toBe(eip155NamespaceManifest.core.keyring);
    expect(stages.session.keyringNamespaces[0]?.factories).not.toBe(eip155NamespaceManifest.core.keyring.factories);

    expect(stages.runtimeSupport.namespaces).toHaveLength(1);
    expect(stages.runtimeSupport.namespaces[0]).toMatchObject({
      namespace: "eip155",
      clientFactory: eip155NamespaceManifest.runtime?.clientFactory,
      createSigner: eip155NamespaceManifest.runtime?.createSigner,
      createApprovalBindings: eip155NamespaceManifest.runtime?.createApprovalBindings,
      createUiBindings: eip155NamespaceManifest.runtime?.createUiBindings,
      createTransaction: eip155NamespaceManifest.runtime?.createTransaction,
    });
  });

  it("rejects duplicate namespace manifests before producing stage output", () => {
    expect(() => assembleRuntimeNamespaceStages([eip155NamespaceManifest, eip155NamespaceManifest])).toThrow(
      /Duplicate namespace manifest "eip155"/,
    );
  });

  it("rejects approval bindings without a signer factory", () => {
    const manifest: NamespaceManifest = {
      ...eip155NamespaceManifest,
      runtime: {
        ...eip155NamespaceManifest.runtime,
        createSigner: undefined,
        createTransaction: undefined,
      },
    };

    expect(() => assembleRuntimeNamespaceStages([manifest])).toThrow(
      /runtime\.createApprovalBindings requires runtime\.createSigner/,
    );
  });

  it("rejects namespace transactions without a signer factory", () => {
    const manifest: NamespaceManifest = {
      ...eip155NamespaceManifest,
      runtime: {
        ...eip155NamespaceManifest.runtime,
        createSigner: undefined,
        createApprovalBindings: undefined,
      },
    };

    expect(() => assembleRuntimeNamespaceStages([manifest])).toThrow(
      /runtime\.createTransaction requires runtime\.createSigner/,
    );
  });

  it("prefers overridden namespace transactions when materializing runtime support", () => {
    const createTransaction = vi.fn(() => {
      throw new Error("manifest transaction should not be constructed");
    });
    const manifest: NamespaceManifest = {
      ...eip155NamespaceManifest,
      runtime: {
        ...eip155NamespaceManifest.runtime,
        createTransaction,
      },
    };
    const stages = assembleRuntimeNamespaceStages([manifest]);
    const overriddenTransaction = {
      proposal: {
        prepare: async () => ({ status: "ready" as const, prepared: {} }),
      },
    };

    const materialized = materializeNamespaceRuntimeSupport({
      runtimeSupport: stages.runtimeSupport,
      rpcClients: {
        getClient: () => undefined,
      },
      chains: createChainAddressCodecRegistryFromManifests([manifest]),
      accountSigning: {} as never,
      rpcClientNamespaces: new Set(["eip155"]),
      transactionOverrides: new NamespaceTransactions([["eip155", overriddenTransaction]]),
    });

    expect(createTransaction).not.toHaveBeenCalled();
    expect(materialized.namespaceTransactions.require("eip155")).toBe(overriddenTransaction);
    expect(materialized.bindings.hasTransactionReceiptTracking("eip155")).toBe(false);
    expect(materialized.runtimeSupport.get("eip155")).toMatchObject({
      hasTransactionReceiptTracking: false,
    });
  });

  it("rejects transaction overrides for namespaces that are not installed", () => {
    const stages = assembleRuntimeNamespaceStages([eip155NamespaceManifest]);
    const solanaOverride = {
      proposal: {
        prepare: async () => ({ status: "ready" as const, prepared: {} }),
      },
    };

    expect(() =>
      materializeNamespaceRuntimeSupport({
        runtimeSupport: stages.runtimeSupport,
        rpcClients: {
          getClient: () => undefined,
        },
        chains: createChainAddressCodecRegistryFromManifests([eip155NamespaceManifest]),
        accountSigning: {} as never,
        rpcClientNamespaces: new Set(["eip155"]),
        transactionOverrides: new NamespaceTransactions([["solana", solanaOverride]]),
      }),
    ).toThrow(/Transaction overrides must target installed namespaces/);
  });
});
