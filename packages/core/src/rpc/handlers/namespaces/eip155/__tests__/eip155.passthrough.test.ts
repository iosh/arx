import type { JsonRpcParams } from "@metamask/utils";
import { describe, expect, it, vi } from "vitest";
import type { RpcClient } from "../../../../index.js";
import { createExecutor, createServices, ORIGIN } from "./eip155.test.helpers.js";

describe("eip155 passthrough executor", () => {
  it("forwards allowed passthrough methods to the RPC client", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    const params = ["0xabc", "latest"] as JsonRpcParams;
    const chainRef = services.controllers.network.getActiveChain().chainRef;
    const rpcClient: Pick<RpcClient, "request"> = {
      request: vi.fn().mockResolvedValue("0x64"),
    };
    const getClient = vi.spyOn(services.rpcClients, "getClient").mockReturnValue(rpcClient as RpcClient);

    try {
      const result = await execute({
        origin: ORIGIN,
        request: { method: "eth_getBalance", params },
      });

      expect(result).toBe("0x64");
      expect(getClient).toHaveBeenCalledWith("eip155", chainRef);
      expect(rpcClient.request).toHaveBeenCalledWith({ method: "eth_getBalance", params });
    } finally {
      getClient.mockRestore();
      services.lifecycle.destroy();
    }
  });

  it("rejects methods outside the passthrough matrix", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    const getClient = vi.spyOn(services.rpcClients, "getClient");

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: { method: "eth_getWork", params: [] as JsonRpcParams },
        }),
      ).rejects.toMatchObject({ code: -32601 });

      expect(getClient).not.toHaveBeenCalled();
    } finally {
      getClient.mockRestore();
      services.lifecycle.destroy();
    }
  });

  it("propagates RPC errors returned by the node", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    const rpcClient: Pick<RpcClient, "request"> = {
      request: vi.fn().mockRejectedValue({ code: -32000, message: "execution reverted" }),
    };
    const getClient = vi.spyOn(services.rpcClients, "getClient").mockReturnValue(rpcClient as RpcClient);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: { method: "eth_getBalance", params: [] as JsonRpcParams },
        }),
      ).rejects.toMatchObject({ code: -32000, message: "execution reverted" });
    } finally {
      getClient.mockRestore();
      services.lifecycle.destroy();
    }
  });

  it("wraps unexpected client failures as internal errors", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    const chainRef = services.controllers.network.getActiveChain().chainRef;
    const rpcClient: Pick<RpcClient, "request"> = {
      request: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const getClient = vi.spyOn(services.rpcClients, "getClient").mockReturnValue(rpcClient as RpcClient);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: { method: "eth_getBalance", params: [] as JsonRpcParams },
        }),
      ).rejects.toMatchObject({
        code: -32603,
        message: 'Failed to execute "eth_getBalance"',
        data: { namespace: "eip155", chainRef },
      });
    } finally {
      getClient.mockRestore();
      services.lifecycle.destroy();
    }
  });
});
