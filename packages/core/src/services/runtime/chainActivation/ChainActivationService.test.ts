import { ArxReasons } from "@arx/errors";
import { describe, expect, it, vi } from "vitest";
import { createChainActivationService } from "./ChainActivationService.js";
import { ChainSelectionSyncPolicies, ProviderChainActivationReasons } from "./types.js";

describe("ChainActivationService", () => {
  it("selects wallet chain by persisting wallet and provider selection", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const setActiveChainRef = vi.fn().mockResolvedValue(undefined);

    const service = createChainActivationService({
      network: {
        getState: () => ({ availableChainRefs: ["eip155:1", "eip155:10"] }),
      } as never,
      preferences: {
        getSelectedChainRef: () => "eip155:1",
        update,
        setActiveChainRef,
      } as never,
    });

    await service.selectWalletChain("eip155:10");

    expect(update).toHaveBeenCalledWith({
      selectedChainRef: "eip155:10",
      activeChainByNamespacePatch: { eip155: "eip155:10" },
    });
    expect(setActiveChainRef).not.toHaveBeenCalled();
  });

  it("rejects wallet selection for chains outside the mounted runtime set", async () => {
    const service = createChainActivationService({
      network: {
        getState: () => ({ availableChainRefs: ["eip155:1"] }),
      } as never,
      preferences: {
        getSelectedChainRef: () => "eip155:1",
        update: vi.fn(),
        setActiveChainRef: vi.fn(),
      } as never,
    });

    await expect(service.selectWalletChain("eip155:999")).rejects.toMatchObject({
      reason: ArxReasons.ChainNotSupported,
    });
  });

  it("surfaces persistence failures when selecting wallet chains", async () => {
    const update = vi.fn().mockRejectedValue(new Error("disk failed"));

    const service = createChainActivationService({
      network: {
        getState: () => ({ availableChainRefs: ["eip155:1", "eip155:10"] }),
      } as never,
      preferences: {
        getSelectedChainRef: () => "eip155:1",
        update,
        setActiveChainRef: vi.fn(),
      } as never,
    });

    await expect(service.selectWalletChain("eip155:10")).rejects.toThrow("disk failed");
  });

  it("activates provider chain without switching selected wallet chain when sync policy is never", async () => {
    const setActiveChainRef = vi.fn().mockResolvedValue(undefined);

    const service = createChainActivationService({
      network: {
        getState: () => ({ availableChainRefs: ["eip155:1", "solana:101"] }),
      } as never,
      preferences: {
        getSelectedChainRef: () => "eip155:1",
        update: vi.fn(),
        setActiveChainRef,
      } as never,
    });

    await service.activateProviderChain({
      namespace: "solana",
      chainRef: "solana:101",
      reason: ProviderChainActivationReasons.SwitchChain,
      syncSelectedChain: ChainSelectionSyncPolicies.Never,
    });

    expect(setActiveChainRef).toHaveBeenCalledWith("solana:101");
  });

  it("syncs selected wallet chain for provider activation when selected namespace matches", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const setActiveChainRef = vi.fn().mockResolvedValue(undefined);

    const service = createChainActivationService({
      network: {
        getState: () => ({ availableChainRefs: ["eip155:1", "eip155:10"] }),
      } as never,
      preferences: {
        getSelectedChainRef: () => "eip155:1",
        update,
        setActiveChainRef,
      } as never,
    });

    await service.activateProviderChain({
      namespace: "eip155",
      chainRef: "eip155:10",
      reason: ProviderChainActivationReasons.SwitchChain,
    });

    expect(update).toHaveBeenCalledWith({
      selectedChainRef: "eip155:10",
      activeChainByNamespacePatch: { eip155: "eip155:10" },
    });
    expect(setActiveChainRef).not.toHaveBeenCalled();
  });

  it("rejects provider activations whose chainRef namespace mismatches the request namespace", async () => {
    const service = createChainActivationService({
      network: {
        getState: () => ({ availableChainRefs: ["eip155:1", "solana:101"] }),
      } as never,
      preferences: {
        getSelectedChainRef: () => "eip155:1",
        update: vi.fn(),
        setActiveChainRef: vi.fn(),
      } as never,
    });

    await expect(
      service.activateProviderChain({
        namespace: "eip155",
        chainRef: "solana:101",
        reason: ProviderChainActivationReasons.SwitchChain,
      }),
    ).rejects.toThrow(/namespace mismatch/i);
  });

  it("preserves not-available errors when syncing provider activation into wallet selection", async () => {
    const service = createChainActivationService({
      network: {
        getState: () => ({ availableChainRefs: ["eip155:1"] }),
      } as never,
      preferences: {
        getSelectedChainRef: () => "eip155:1",
        update: vi.fn(),
        setActiveChainRef: vi.fn(),
      } as never,
    });

    await expect(
      service.activateProviderChain({
        namespace: "eip155",
        chainRef: "eip155:999",
        reason: ProviderChainActivationReasons.SwitchChain,
      }),
    ).rejects.toMatchObject({
      reason: ArxReasons.ChainNotSupported,
      data: { chainRef: "eip155:999" },
    });
  });
});
