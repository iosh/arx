import "fake-indexeddb/auto";

import { type CoreRuntime, createCoreRuntime } from "@arx/core/runtime";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { createDexiePersistence, type DexiePersistence } from "./createDexiePersistence.js";

const opened: { runtime: CoreRuntime; persistence: DexiePersistence }[] = [];
let databaseId = 0;
const open = async (databaseName = `arx-rpc-runtime-${databaseId++}`) => {
  const persistence = createDexiePersistence({ databaseName });
  const runtime = await createCoreRuntime({ persistence });
  opened.push({ runtime, persistence });
  return { runtime, persistence };
};

afterEach(async () => {
  for (const { runtime, persistence } of opened.splice(0)) {
    await runtime.wallet.lock();
    await persistence.close();
  }
  vi.unstubAllGlobals();
});

describe("CoreRuntime EIP-155 RPC", () => {
  it("queries an uninstalled node and restores all saved RPC endpoints without bootstrap requests", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (endpoint, init) => {
      const request = JSON.parse((init as RequestInit).body as string) as { id: number; method: string };
      const base = String(endpoint).startsWith("https://base");
      const result = request.method === "eth_chainId" ? (base ? "0x2105" : "0x1") : "0x1234";
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
    });
    vi.stubGlobal("fetch", fetch);
    const databaseName = `arx-rpc-runtime-${databaseId++}`;
    const { runtime, persistence } = await open(databaseName);
    expect(fetch).not.toHaveBeenCalled();

    await expect(runtime.wallet.eip155.eth_chainId([], { endpoint: "https://base.example" })).resolves.toBe("0x2105");
    expect(await runtime.wallet.networks.get("eip155:8453")).toBeNull();
    await runtime.wallet.networks.addCustom({
      definition: {
        chainRef: "eip155:8453",
        name: "Base",
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      },
      defaultRpcEndpoints: ["https://base.example", "https://base-backup.example"],
    });
    await runtime.wallet.lock();
    await persistence.close();

    fetch.mockClear();
    const restored = (await open(databaseName)).runtime;
    expect(fetch).not.toHaveBeenCalled();
    await expect(restored.wallet.networks.getRpcConfiguration("eip155:8453")).resolves.toMatchObject({
      source: "default",
      endpoints: ["https://base.example", "https://base-backup.example"],
    });
    await expect(restored.wallet.eip155.eth_chainId([], { chainRef: "eip155:8453" })).resolves.toBe("0x2105");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("signs empty personal data only after dapp authorization and approval", async () => {
    const { runtime } = await open();
    const wallet = runtime.wallet;
    const created = await wallet.createFromPrivateKey({
      password: "password",
      namespace: "eip155",
      privateKey: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    });
    assert(created.status === "initialized");
    const [account] = (await wallet.accounts.getGroup(created.accountGroupId)).members;
    const address = "0xfcad0b19bb29d4674531d6f115237e16afce377c";
    const scope = { origin: "https://signing.example", namespace: "eip155" };
    runtime.dappConnections.openConnection(scope);
    const params = ["0x", address] as const;
    await expect(runtime.dappConnections.request({ scope, method: "personal_sign", params })).rejects.toMatchObject({
      code: "global.rpc.unauthorized",
    });
    expect(await wallet.approvals.list()).toEqual([]);

    await wallet.permissions.setAccounts({ ...scope, accountIds: [account.accountId] });
    const dappSignature = runtime.dappConnections.request({ scope, method: "personal_sign", params });
    const [approval] = await wallet.approvals.list();
    assert(approval?.type === "sign" && approval.request.type === "personalMessage");
    expect(approval.request.message).toEqual({ format: "hex", value: "0x" });
    await wallet.approvals.approve({ approvalId: approval.approvalId, type: "sign" });
    // EIP-191 empty-byte signature for the public private-key fixture.
    await expect(dappSignature).resolves.toBe(
      "0xe69e62383070377b9c305f0a39dc0c6ed003afe3cded630af4b144ed3899147768106a3b2a064099d98a59d1e0ed06ec4bb6fb2d6c3306daa0db0cd9255cfc0d1b",
    );
  }, 15_000);
});
