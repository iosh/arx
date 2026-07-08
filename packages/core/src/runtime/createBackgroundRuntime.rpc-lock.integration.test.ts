import type { JsonRpcParams } from "@metamask/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accountIdFromChainAddress } from "../accounts/addressing/accountId.js";
import { createRpcHarness, flushAsync, TEST_MNEMONIC } from "./__fixtures__/backgroundTestSetup.js";

const PASSWORD = "secret-pass";
const MESSAGE = "0x68656c6c6f";
const ORIGIN = "https://dapp.example";

type RpcHarnessInstance = Awaited<ReturnType<typeof createRpcHarness>>;
const initializeSession = async (runtime: RpcHarnessInstance["runtime"]) => {
  await runtime.services.session.createVault({ password: PASSWORD });
  await runtime.services.session.unlock.unlock({ password: PASSWORD });
};

const deriveAccount = async (runtime: RpcHarnessInstance["runtime"]) => {
  const chain = runtime.services.chainViews.getSelectedChainView();
  const { keyringId } = await runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });
  const account = await runtime.services.keyring.deriveAccount(keyringId);
  await runtime.services.accounts.setActiveAccount({
    namespace: chain.namespace,
    chainRef: chain.chainRef,
    accountId: accountIdFromChainAddress({
      chainRef: chain.chainRef,
      address: account.address,
      accountAddressing: runtime.services.accountAddressing,
    }),
  });
  return { chain, address: account.address };
};

describe("createBackgroundRuntime (locked RPC integration)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows read passthrough methods while locked", async () => {
    const harness = await createRpcHarness();
    const { runtime } = harness;
    const rpcClient = { request: vi.fn().mockResolvedValue("0x64") };
    const getClient = vi
      .spyOn(runtime.rpc.clients, "getClient")
      .mockReturnValue(rpcClient as unknown as ReturnType<(typeof runtime.rpc.clients)["getClient"]>);

    try {
      await initializeSession(runtime);
      runtime.services.session.unlock.lock("manual");

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
        retry: { transportFailure: true },
      });
    } finally {
      getClient.mockRestore();
    }
  });

  it("rejects passthrough methods that require an unlocked session", async () => {
    const harness = await createRpcHarness();
    const { runtime } = harness;
    const getClient = vi.spyOn(runtime.rpc.clients, "getClient");

    try {
      await initializeSession(runtime);
      runtime.services.session.unlock.lock("manual");

      await expect(
        harness.callRpc({
          method: "eth_newFilter",
          params: [{ address: "0xdeadbeef" }] as JsonRpcParams,
        }),
      ).rejects.toMatchObject({
        kind: "ArxError",
        code: "global.session.locked",
      });

      expect(getClient).not.toHaveBeenCalled();
    } finally {
      getClient.mockRestore();
    }
  });

  it("enforces lock semantics for eth_accounts and personal_sign", async () => {
    const harness = await createRpcHarness();
    const { runtime } = harness;
    const approval = vi.spyOn(runtime.services.approvals, "create");
    let approvalId: string | null = null;
    const approvalRequested = new Promise<void>((resolve) => {
      const unsubscribe = runtime.services.approvals.onCreated(({ record }) => {
        approvalId = record.approvalId;
        unsubscribe();
        resolve();
      });
    });

    try {
      await initializeSession(runtime);
      const { chain, address } = await deriveAccount(runtime);

      await runtime.services.permissions.grantAuthorization(ORIGIN, {
        namespace: chain.namespace,
        chains: [
          {
            chainRef: chain.chainRef,
            accountIds: [
              accountIdFromChainAddress({
                chainRef: chain.chainRef,
                address,
                accountAddressing: runtime.services.accountAddressing,
              }),
            ],
          },
        ],
      });

      runtime.services.session.unlock.lock("manual");

      await expect(harness.callRpc({ method: "eth_accounts" })).resolves.toEqual([]);

      const pending = harness.callRpc({
        method: "personal_sign",
        params: [MESSAGE, address] as JsonRpcParams,
      });

      let settled = false;
      void pending.finally(() => {
        settled = true;
      });
      await approvalRequested;
      await flushAsync();

      expect(approval).toHaveBeenCalledTimes(1);
      // While locked, the request should be pending on the approval (not hard-rejected).
      expect(settled).toBe(false);
      expect(approvalId).toBeTruthy();

      await runtime.services.session.unlock.unlock({ password: PASSWORD });

      const accounts = (await harness.callRpc({ method: "eth_accounts" })) as string[];
      expect(accounts.map((value) => value.toLowerCase())).toContain(address.toLowerCase());

      if (!approvalId) throw new Error("Expected approvalId to be set");
      await runtime.services.approvals.resolve({ approvalId, action: "approve" });
      await expect(pending).resolves.toMatch(/^0x[0-9a-f]+$/i);

      expect(approval).toHaveBeenCalledTimes(1);
    } finally {
      approval.mockRestore();
    }
  });
});
