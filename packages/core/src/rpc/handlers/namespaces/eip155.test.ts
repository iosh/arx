import type { JsonRpcParams } from "@metamask/utils";
import { describe, expect, it } from "vitest";
import { createBackgroundServices } from "../../../runtime/createBackgroundServices.js";
import { createMethodExecutor } from "../../index.js";

const ORIGIN = "https://dapp.example";

const ALT_CHAIN = {
  chainRef: "eip155:10",
  namespace: "eip155",
  chainId: "0xa",
  displayName: "Optimism",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.optimism.example", type: "public" as const }],
  features: ["eip155", "wallet_switchEthereumChain"],
};

const createServices = () =>
  createBackgroundServices({
    chainRegistry: {
      port: {
        async get() {
          return null;
        },
        async getAll() {
          return [];
        },
        async put() {},
        async putMany() {},
        async delete() {},
        async clear() {},
      },
    },
  });
// TODO: add eth_requestAccounts rejection test once approval  -> account flow is implemented

describe("eip155 handlers - core error paths", () => {
  it("return 4902 for wallet_switchEthereumChain when the chain is unknown", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

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

  it("switches chains and retains the active account when wallet_switchEthereumChain succeeds", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createMethodExecutor(services.controllers);
    const mainnet = services.controllers.network.getActiveChain();

    await services.controllers.network.addChain(ALT_CHAIN);

    const activeAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    await services.controllers.accounts.addAccount({
      chainRef: mainnet.chainRef,
      address: activeAddress,
      makePrimary: true,
    });
    await services.controllers.accounts.switchActive({ chainRef: mainnet.chainRef, address: activeAddress });

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ chainId: ALT_CHAIN.chainId }] as JsonRpcParams,
          },
        }),
      ).resolves.toBeNull();

      expect(services.controllers.network.getActiveChain().chainRef).toBe(ALT_CHAIN.chainRef);
      expect(services.controllers.accounts.getActivePointer()).toMatchObject({
        chainRef: ALT_CHAIN.chainRef,
        address: activeAddress,
        namespace: "eip155",
      });
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("switches chains when only caip2 is provided", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createMethodExecutor(services.controllers);
    await services.controllers.network.addChain(ALT_CHAIN);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ caip2: ALT_CHAIN.chainRef }] as JsonRpcParams,
          },
        }),
      ).resolves.toBeNull();

      expect(services.controllers.network.getActiveChain().chainRef).toBe(ALT_CHAIN.chainRef);
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("rejects when chainId and caip2 do not match", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createMethodExecutor(services.controllers);
    await services.controllers.network.addChain(ALT_CHAIN);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x1", caip2: ALT_CHAIN.chainRef }] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({
        code: -32602,
      });
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("rejects invalid hex chainId values", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createMethodExecutor(services.controllers);

    try {
      // Test both forms: non-hex string and invalid hex characters
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "not-hex" }] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({ code: -32602 });

      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0xGG" }] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({ code: -32602 });
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("returns 4902 when chain lacks wallet_switchEthereumChain feature", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createMethodExecutor(services.controllers);
    await services.controllers.network.addChain({
      ...ALT_CHAIN,
      chainRef: "eip155:8453",
      chainId: "0x2105",
      displayName: "Base",
      features: ["eip155"],
    });

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x2105" }] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({
        code: 4902,
      });
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("rejects non-eip155 namespaces", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createMethodExecutor(services.controllers);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ caip2: "conflux:cfx" }] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({
        code: 4902,
      });
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("rejects when no chain parameters are provided", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createMethodExecutor(services.controllers);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({
        code: -32602,
      });

      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{}] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({
        code: -32602,
      });
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("emits chainChanged event on successful switch", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createMethodExecutor(services.controllers);
    await services.controllers.network.addChain(ALT_CHAIN);

    const changes: string[] = [];
    const unsubscribe = services.controllers.network.onChainChanged((chain) => {
      changes.push(chain.chainRef);
    });

    try {
      await execute({
        origin: ORIGIN,
        request: {
          method: "wallet_switchEthereumChain",
          params: [{ chainId: ALT_CHAIN.chainId }] as JsonRpcParams,
        },
      });

      expect(changes).toContain(ALT_CHAIN.chainRef);
    } finally {
      unsubscribe();
      services.lifecycle.destroy();
    }
  });

  it("throw invalid params when eth_sendTransaction receives no payload", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

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
