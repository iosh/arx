import { ArxReasons, arxError } from "@arx/errors";
import { describe, expect, it, vi } from "vitest";
import { createChainActivationService } from "./ChainActivationService.js";

describe("ChainActivationService", () => {
  it("switches the network and persists the active chain", async () => {
    const switchChain = vi.fn().mockResolvedValue(undefined);
    const setActiveChainRef = vi.fn().mockResolvedValue(undefined);

    const service = createChainActivationService({
      network: {
        getState: () => ({ activeChainRef: "eip155:1" }),
        switchChain,
      } as never,
      preferences: { setActiveChainRef } as never,
    });

    await service.activate("eip155:10");

    expect(switchChain).toHaveBeenCalledWith("eip155:10");
    expect(setActiveChainRef).toHaveBeenCalledWith("eip155:10");
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
      preferences: { setActiveChainRef: vi.fn() } as never,
    });

    await expect(service.activate("eip155:999")).rejects.toMatchObject({ reason: ArxReasons.ChainNotSupported });
  });

  it("rolls back the network switch when preference persistence fails", async () => {
    const switchChain = vi.fn().mockResolvedValue(undefined);
    const setActiveChainRef = vi.fn().mockRejectedValue(new Error("disk failed"));
    const logger = vi.fn();

    const service = createChainActivationService({
      network: {
        getState: () => ({ activeChainRef: "eip155:1" }),
        switchChain,
      } as never,
      preferences: { setActiveChainRef } as never,
      logger,
    });

    await expect(service.activate("eip155:10")).rejects.toThrow("disk failed");
    expect(switchChain).toHaveBeenNthCalledWith(1, "eip155:10");
    expect(switchChain).toHaveBeenNthCalledWith(2, "eip155:1");
    expect(logger).not.toHaveBeenCalled();
  });
});
