import type { JsonRpcParams } from "@metamask/utils";
import { describe, expect, it } from "vitest";
import { createBackgroundServices } from "../../../runtime/createBackgroundServices.js";
import { createMethodExecutor } from "../../index.js";

const ORIGIN = "https://dapp.example";

// TODO: add eth_requestAccounts rejection test once approval  -> account flow is implemented

describe("eip155 handlers - core error paths", () => {
  it("return 4902 for wallet_switchEthereumChain when the chain is unknown", async () => {
    const services = createBackgroundServices();
    const execute = createMethodExecutor(services.controllers);
    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x9999" }] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({
        code: 4902,
        message: "Requested chain is not registered with ARX",
      });
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("throw invalid params when eth_sendTransaction receives no payload", async () => {
    const services = createBackgroundServices();
    const execute = createMethodExecutor(services.controllers);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: { method: "eth_sendTransaction", params: [] as JsonRpcParams },
        }),
      ).rejects.toMatchObject({
        code: -32602,
        message: "eth_sendTransaction requires at least one transaction parameter",
      });
    } finally {
      services.lifecycle.destroy();
    }
  });
});
