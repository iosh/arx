import { ArxReasons } from "@arx/errors";
import { describe, expect, it, vi } from "vitest";
import { createChainActivationService } from "./ChainActivationService.js";
import { NamespaceChainActivationReasons } from "./types.js";

const createService = (params?: {
  availableChainRefs?: string[];
  activeChainByNamespace?: Record<string, string>;
  selectChain?: ReturnType<typeof vi.fn>;
  selectNamespace?: ReturnType<typeof vi.fn>;
}) => {
  const selectChain = params?.selectChain ?? vi.fn().mockResolvedValue(undefined);
  const selectNamespace = params?.selectNamespace ?? vi.fn().mockResolvedValue(undefined);

  const service = createChainActivationService({
    network: {
      getState: () => ({ availableChainRefs: params?.availableChainRefs ?? ["eip155:1", "eip155:10", "solana:101"] }),
    } as never,
    networkSelection: {
      getSelectedChainRef: (namespace: string) => params?.activeChainByNamespace?.[namespace] ?? null,
      selectChain,
      selectNamespace,
    } as never,
  });

  return {
    service,
    selectChain,
    selectNamespace,
  };
};

describe("ChainActivationService", () => {
  it("selects wallet chain by persisting the chain selection", async () => {
    const { service, selectChain, selectNamespace } = createService();

    await service.selectWalletChain("eip155:10");

    expect(selectChain).toHaveBeenCalledWith("eip155:10");
    expect(selectNamespace).not.toHaveBeenCalled();
  });

  it("rejects wallet selection for chains outside the mounted runtime set", async () => {
    const { service } = createService({ availableChainRefs: ["eip155:1"] });

    await expect(service.selectWalletChain("eip155:999")).rejects.toMatchObject({
      reason: ArxReasons.ChainNotSupported,
    });
  });

  it("surfaces persistence failures when selecting wallet chains", async () => {
    const { service } = createService({
      selectChain: vi.fn().mockRejectedValue(new Error("disk failed")),
    });

    await expect(service.selectWalletChain("eip155:10")).rejects.toThrow("disk failed");
  });

  it("selects wallet namespace without rewriting namespace active chains", async () => {
    const { service, selectChain, selectNamespace } = createService({
      activeChainByNamespace: { eip155: "eip155:1", solana: "solana:101" },
    });

    await service.selectWalletNamespace("solana");

    expect(selectNamespace).toHaveBeenCalledWith("solana");
    expect(selectChain).not.toHaveBeenCalled();
  });

  it("rejects wallet namespace selection when no active chain is configured for that namespace", async () => {
    const { service } = createService({
      activeChainByNamespace: { eip155: "eip155:1" },
    });

    await expect(service.selectWalletNamespace("solana")).rejects.toMatchObject({
      reason: ArxReasons.ChainNotSupported,
      data: { namespace: "solana" },
    });
  });

  it("rejects wallet namespace selection when the configured active chain is unavailable", async () => {
    const { service } = createService({
      availableChainRefs: ["eip155:1"],
      activeChainByNamespace: { eip155: "eip155:1", solana: "solana:101" },
    });

    await expect(service.selectWalletNamespace("solana")).rejects.toMatchObject({
      reason: ArxReasons.ChainNotSupported,
      data: { chainRef: "solana:101" },
    });
  });

  it("activates namespace chains without changing wallet focus owners", async () => {
    const { service, selectChain, selectNamespace } = createService({
      activeChainByNamespace: { eip155: "eip155:1", solana: "solana:101" },
    });

    await service.activateNamespaceChain({
      namespace: "solana",
      chainRef: "solana:101",
      reason: NamespaceChainActivationReasons.SwitchChain,
    });

    expect(selectChain).toHaveBeenCalledWith("solana:101");
    expect(selectNamespace).not.toHaveBeenCalled();
  });

  it("rejects namespace activations whose chainRef namespace mismatches the request namespace", async () => {
    const { service } = createService();

    await expect(
      service.activateNamespaceChain({
        namespace: "eip155",
        chainRef: "solana:101",
        reason: NamespaceChainActivationReasons.SwitchChain,
      }),
    ).rejects.toMatchObject({
      reason: ArxReasons.ChainNotCompatible,
      data: {
        expectedNamespace: "eip155",
        actualNamespace: "solana",
        chainRef: "solana:101",
      },
    });
  });

  it("rejects unavailable namespace activations before persisting selection", async () => {
    const { service, selectChain } = createService({
      availableChainRefs: ["eip155:1"],
    });

    await expect(
      service.activateNamespaceChain({
        namespace: "eip155",
        chainRef: "eip155:999",
        reason: NamespaceChainActivationReasons.SwitchChain,
      }),
    ).rejects.toMatchObject({
      reason: ArxReasons.ChainNotSupported,
      data: { chainRef: "eip155:999" },
    });
    expect(selectChain).not.toHaveBeenCalled();
  });
});
