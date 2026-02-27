import type { JsonRpcParams } from "@metamask/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PermissionCapabilities } from "../controllers/index.js";
import { createRpcHarness, flushAsync, TEST_MNEMONIC } from "./__fixtures__/backgroundTestSetup.js";

const PASSWORD = "secret-pass";
const MESSAGE = "0x68656c6c6f";
const ORIGIN = "https://dapp.example";

type RpcHarnessInstance = Awaited<ReturnType<typeof createRpcHarness>>;
const initializeSession = async (runtime: RpcHarnessInstance["runtime"]) => {
  await runtime.services.session.vault.initialize({ password: PASSWORD });
  await runtime.services.session.unlock.unlock({ password: PASSWORD });
};

const deriveAccount = async (runtime: RpcHarnessInstance["runtime"]) => {
  const chain = runtime.controllers.network.getActiveChain();
  const { keyringId } = await runtime.services.keyring.confirmNewMnemonic(TEST_MNEMONIC);
  const account = await runtime.services.keyring.deriveAccount(keyringId);
  await runtime.controllers.accounts.switchActive({ chainRef: chain.chainRef, address: account.address });
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
      });
    } finally {
      getClient.mockRestore();
      harness.destroy();
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
    const { runtime } = harness;
    const approval = vi.spyOn(runtime.controllers.approvals, "requestApproval");
    let approvalId: string | null = null;
    const approvalRequested = new Promise<void>((resolve) => {
      const unsubscribe = runtime.controllers.approvals.onRequest(({ task }) => {
        approvalId = task.id;
        unsubscribe();
        resolve();
      });
    });

    try {
      await initializeSession(runtime);
      const { chain, address } = await deriveAccount(runtime);

      await runtime.controllers.permissions.grant(ORIGIN, PermissionCapabilities.Basic, {
        namespace: chain.namespace,
        chainRef: chain.chainRef,
      });
      await runtime.controllers.permissions.grant(ORIGIN, PermissionCapabilities.Sign, {
        namespace: chain.namespace,
        chainRef: chain.chainRef,
      });

      await runtime.controllers.permissions.setPermittedAccounts(ORIGIN, {
        namespace: chain.namespace,
        chainRef: chain.chainRef,
        accounts: [address],
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
      await runtime.controllers.permissions.grant(ORIGIN, PermissionCapabilities.Sign, {
        namespace: chain.namespace,
        chainRef: chain.chainRef,
      });

      const accounts = (await harness.callRpc({ method: "eth_accounts" })) as string[];
      expect(accounts.map((value) => value.toLowerCase())).toContain(address.toLowerCase());

      if (!approvalId) throw new Error("Expected approvalId to be set");
      await runtime.controllers.approvals.resolve(approvalId, async () => "0xsignedpayload");
      await expect(pending).resolves.toBe("0xsignedpayload");

      expect(approval).toHaveBeenCalledTimes(1);
    } finally {
      approval.mockRestore();
      harness.destroy();
    }
  });

  it("allows personal_sign when connected but Sign capability is missing", async () => {
    const harness = await createRpcHarness();
    const { runtime } = harness;
    const approval = vi.spyOn(runtime.controllers.approvals, "requestApproval").mockResolvedValue("0xsignedpayload");

    try {
      await initializeSession(runtime);
      const { chain, address } = await deriveAccount(runtime);

      // Simulate a connected origin (Accounts capability present), but do NOT grant Sign capability.
      await runtime.controllers.permissions.grant(ORIGIN, PermissionCapabilities.Basic, {
        namespace: chain.namespace,
        chainRef: chain.chainRef,
      });
      await runtime.controllers.permissions.setPermittedAccounts(ORIGIN, {
        namespace: chain.namespace,
        chainRef: chain.chainRef,
        accounts: [address],
      });

      const beforeCapabilities =
        runtime.controllers.permissions.getState().origins[ORIGIN]?.[chain.namespace]?.chains[chain.chainRef]
          ?.capabilities ?? [];
      expect(beforeCapabilities).not.toContain(PermissionCapabilities.Sign);

      await expect(
        harness.callRpc({
          origin: ORIGIN,
          method: "personal_sign",
          params: [MESSAGE, address] as JsonRpcParams,
        }),
      ).resolves.toBe("0xsignedpayload");

      expect(approval).toHaveBeenCalledTimes(1);

      const afterCapabilities =
        runtime.controllers.permissions.getState().origins[ORIGIN]?.[chain.namespace]?.chains[chain.chainRef]
          ?.capabilities ?? [];
      expect(afterCapabilities).toContain(PermissionCapabilities.Sign);
    } finally {
      approval.mockRestore();
      harness.destroy();
    }
  });
});
