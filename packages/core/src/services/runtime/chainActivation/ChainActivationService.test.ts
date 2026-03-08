import { ArxReasons, arxError } from "@arx/errors";
import { describe, expect, it, vi } from "vitest";
import { createChainActivationService } from "./ChainActivationService.js";
import { ChainSelectionSyncPolicies, ProviderChainActivationReasons } from "./types.js";

describe("ChainActivationService", () => {
  it("selects wallet chain by switching the network and persisting provider selection", async () => {
    const switchChain = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(undefined);
    const setActiveChainRef = vi.fn().mockResolvedValue(undefined);

    const service = createChainActivationService({
      network: {
        getState: () => ({ activeChainRef: "eip155:1" }),
        switchChain,
      } as never,
      preferences: { update, setActiveChainRef } as never,
    });

    await service.selectWalletChain("eip155:10");

    expect(switchChain).toHaveBeenCalledWith("eip155:10");
    expect(update).toHaveBeenCalledWith({
      selectedChainRef: "eip155:10",
      activeChainByNamespacePatch: { eip155: "eip155:10" },
    });
    expect(setActiveChainRef).not.toHaveBeenCalled();
  });

  it("keeps legacy activate as an alias for wallet chain selection", async () => {
    const switchChain = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(undefined);
    const setActiveChainRef = vi.fn().mockResolvedValue(undefined);

    const service = createChainActivationService({
      network: {
        getState: () => ({ activeChainRef: "eip155:1" }),
        switchChain,
      } as never,
      preferences: { update, setActiveChainRef } as never,
    });

    await service.activate("eip155:10");

    expect(switchChain).toHaveBeenCalledWith("eip155:10");
    expect(update).toHaveBeenCalledWith({
      selectedChainRef: "eip155:10",
      activeChainByNamespacePatch: { eip155: "eip155:10" },
    });
    expect(setActiveChainRef).not.toHaveBeenCalled();
  });

  it("surfaces non-activatable targets from the network controller", async () => {
    const switchError = arxError({
      reason: ArxReasons.ChainNotSupported,
      message: "not available",
      data: { chainRef: "eip155:999" },
    });

    const service = createChainActivationService({
      network: {
        getState: () => ({ activeChainRef: "eip155:1" }),
        switchChain: vi.fn().mockRejectedValue(switchError),
      } as never,
      preferences: { update: vi.fn(), setActiveChainRef: vi.fn() } as never,
    });

    await expect(service.activate("eip155:999")).rejects.toMatchObject({ reason: ArxReasons.ChainNotSupported });
  });

  it("rolls back the network switch when preference persistence fails", async () => {
    const switchChain = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockRejectedValue(new Error("disk failed"));
    const logger = vi.fn();

    const service = createChainActivationService({
      network: {
        getState: () => ({ activeChainRef: "eip155:1" }),
        switchChain,
      } as never,
      preferences: { update, setActiveChainRef: vi.fn() } as never,
      logger,
    });

    await expect(service.activate("eip155:10")).rejects.toThrow("disk failed");
    expect(switchChain).toHaveBeenNthCalledWith(1, "eip155:10");
    expect(switchChain).toHaveBeenNthCalledWith(2, "eip155:1");
    expect(logger).not.toHaveBeenCalled();
  });

  it("activates provider chain without switching selected wallet chain when sync policy is never", async () => {
    const switchChain = vi.fn().mockResolvedValue(undefined);
    const setActiveChainRef = vi.fn().mockResolvedValue(undefined);

    const service = createChainActivationService({
      network: {
        getState: () => ({ activeChainRef: "eip155:1" }),
        switchChain,
      } as never,
      preferences: { update: vi.fn(), setActiveChainRef } as never,
    });

    await service.activateProviderChain({
      namespace: "solana",
      chainRef: "solana:101",
      reason: ProviderChainActivationReasons.SwitchChain,
      syncSelectedChain: ChainSelectionSyncPolicies.Never,
    });

    expect(switchChain).not.toHaveBeenCalled();
    expect(setActiveChainRef).toHaveBeenCalledWith("solana:101");
  });

  it("syncs selected wallet chain for provider activation when selected namespace matches", async () => {
    const switchChain = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(undefined);
    const setActiveChainRef = vi.fn().mockResolvedValue(undefined);

    const service = createChainActivationService({
      network: {
        getState: () => ({ activeChainRef: "eip155:1" }),
        switchChain,
      } as never,
      preferences: { update, setActiveChainRef } as never,
    });

    await service.activateProviderChain({
      namespace: "eip155",
      chainRef: "eip155:10",
      reason: ProviderChainActivationReasons.SwitchChain,
    });

    expect(switchChain).toHaveBeenCalledWith("eip155:10");
    expect(update).toHaveBeenCalledWith({
      selectedChainRef: "eip155:10",
      activeChainByNamespacePatch: { eip155: "eip155:10" },
    });
    expect(setActiveChainRef).not.toHaveBeenCalled();
  });

  it("rejects provider activations whose chainRef namespace mismatches the request namespace", async () => {
    const service = createChainActivationService({
      network: {
        getState: () => ({ activeChainRef: "eip155:1" }),
        switchChain: vi.fn(),
      } as never,
      preferences: { update: vi.fn(), setActiveChainRef: vi.fn() } as never,
    });

    await expect(
      service.activateProviderChain({
        namespace: "eip155",
        chainRef: "solana:101",
        reason: ProviderChainActivationReasons.SwitchChain,
      }),
    ).rejects.toThrow(/namespace mismatch/i);
  });
});
