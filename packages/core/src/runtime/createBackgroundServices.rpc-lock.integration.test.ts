import type { JsonRpcParams } from "@metamask/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PermissionScopes } from "../controllers/index.js";
import { createRpcHarness, TEST_MNEMONIC } from "./__fixtures__/backgroundTestSetup.js";

const PASSWORD = "secret-pass";
const MESSAGE = "0x68656c6c6f";
const ORIGIN = "https://dapp.example";

type RpcHarnessInstance = Awaited<ReturnType<typeof createRpcHarness>>;
const initializeSession = async (services: RpcHarnessInstance["services"]) => {
  await services.session.vault.initialize({ password: PASSWORD });
  await services.session.unlock.unlock({ password: PASSWORD });
};

const deriveAccount = async (services: RpcHarnessInstance["services"]) => {
  const chain = services.controllers.network.getActiveChain();
  const { keyringId } = await services.keyring.confirmNewMnemonic(TEST_MNEMONIC);
  const { account } = await services.accountsRuntime.deriveAccount({
    namespace: chain.namespace,
    chainRef: chain.chainRef,
    keyringId,
    makePrimary: true,
    switchActive: true,
  });
  return { chain, address: account.address };
};

describe("createBackgroundServices (locked RPC integration)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows read passthrough methods while locked", async () => {
    const harness = await createRpcHarness();
    const { services } = harness;
    const rpcClient = { request: vi.fn().mockResolvedValue("0x64") };
    const getClient = vi.spyOn(services.rpcClients, "getClient").mockReturnValue(rpcClient as any);

    try {
      await initializeSession(services);
      services.session.unlock.lock("manual");

      await expect(
        harness.callRpc({
          method: "eth_getBalance",
          params: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "latest"] as JsonRpcParams,
        }),
      ).resolves.toBe("0x64");

      expect(getClient).toHaveBeenCalledTimes(1);
      expect(rpcClient.request).toHaveBeenCalledWith({
        method: "eth_getBalance",
        params: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "latest"],
      });
    } finally {
      getClient.mockRestore();
      harness.destroy();
    }
  });

  it("rejects passthrough methods that require an unlocked session", async () => {
    const harness = await createRpcHarness();
    const { services } = harness;
    const getClient = vi.spyOn(services.rpcClients, "getClient");

    try {
      await initializeSession(services);
      services.session.unlock.lock("manual");

      await expect(
        harness.callRpc({
          method: "eth_newFilter",
          params: [{ address: "0xdeadbeef" }] as JsonRpcParams,
        }),
      ).rejects.toMatchObject({
        code: 4100,
        message: "Request eth_newFilter requires an unlocked session",
      });

      expect(getClient).not.toHaveBeenCalled();
    } finally {
      getClient.mockRestore();
      harness.destroy();
    }
  });

  it("enforces lock semantics for eth_accounts and personal_sign", async () => {
    const harness = await createRpcHarness();
    const { services } = harness;
    const approval = vi.spyOn(services.controllers.approvals, "requestApproval").mockResolvedValue("0xsignedpayload");

    try {
      await initializeSession(services);
      const { chain, address } = await deriveAccount(services);

      await services.controllers.permissions.grant(ORIGIN, PermissionScopes.Basic, {
        namespace: chain.namespace,
        chainRef: chain.chainRef,
      });
      await services.controllers.permissions.grant(ORIGIN, PermissionScopes.Accounts, {
        namespace: chain.namespace,
        chainRef: chain.chainRef,
      });
      await services.controllers.permissions.grant(ORIGIN, PermissionScopes.Sign, {
        namespace: chain.namespace,
        chainRef: chain.chainRef,
      });

      await services.controllers.permissions.setPermittedAccounts(ORIGIN, {
        namespace: chain.namespace,
        chainRef: chain.chainRef,
        accounts: [address],
      });

      services.session.unlock.lock("manual");

      await expect(harness.callRpc({ method: "eth_accounts" })).resolves.toEqual([]);

      await expect(
        harness.callRpc({
          method: "personal_sign",
          params: [MESSAGE, address] as JsonRpcParams,
        }),
      ).rejects.toMatchObject({
        code: 4100,
        message: "Request personal_sign requires an unlocked session",
      });

      await services.session.unlock.unlock({ password: PASSWORD });
      await services.controllers.permissions.grant(ORIGIN, PermissionScopes.Sign, {
        namespace: chain.namespace,
        chainRef: chain.chainRef,
      });

      await expect(harness.callRpc({ method: "eth_accounts" })).resolves.toEqual(expect.arrayContaining([address]));

      await expect(
        harness.callRpc({
          method: "personal_sign",
          params: [MESSAGE, address] as JsonRpcParams,
        }),
      ).resolves.toBe("0xsignedpayload");

      expect(approval).toHaveBeenCalledTimes(1);
    } finally {
      approval.mockRestore();
      harness.destroy();
    }
  });
});
