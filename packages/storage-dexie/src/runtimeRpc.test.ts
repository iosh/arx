import "fake-indexeddb/auto";

import { persistenceTypes } from "@arx/core/persistence";
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
  it("rejects malformed raw transactions and reports an uncertain broadcast without replaying it", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetch);
    const { runtime } = await open();
    const scope = { origin: "https://rpc.example", namespace: "eip155" } as const;
    runtime.dappConnections.openConnection(scope);
    const sendRawTransaction = (rawTransaction: string) =>
      runtime.dappConnections.request({ scope, method: "eth_sendRawTransaction", params: [rawTransaction] });

    for (const rawTransaction of ["0x", "0x1"]) {
      await expect(sendRawTransaction(rawTransaction)).rejects.toMatchObject({ code: "global.rpc.invalid_params" });
    }
    expect(fetch).not.toHaveBeenCalled();
    await expect(sendRawTransaction("0x01")).rejects.toMatchObject({ code: "global.rpc.outcome_unknown" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("adds an approved dapp network, restores its RPC override, and removes its saved references", async () => {
    const chainRef = "eip155:8453";
    const defaultEndpoint = "https://base.example";
    const overrideEndpoint = "https://base-active.example";
    const explorerUrls = ["https://basescan.org", "https://base.blockscout.com"];
    const fetch = vi.fn<typeof globalThis.fetch>(async (_endpoint, init) => {
      const { id, method } = JSON.parse(String(init?.body)) as { id: number; method: string };
      if (method !== "eth_chainId" && method !== "eth_blockNumber") throw new Error(`Unexpected RPC method ${method}`);
      const result = method === "eth_chainId" ? "0x2105" : "0x1234";
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }));
    });
    vi.stubGlobal("fetch", fetch);
    const databaseName = `arx-rpc-runtime-${databaseId++}`;
    const { runtime, persistence } = await open(databaseName);
    const scope = { origin: "https://base-site.example", namespace: "eip155" } as const;
    runtime.dappConnections.openConnection(scope);

    const request = runtime.dappConnections.request({
      scope,
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: "0x2105",
          chainName: "Base",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["http://base.example", defaultEndpoint, "https://base-backup.example"],
          blockExplorerUrls: ["http://base.example", ...explorerUrls],
          iconUrls: ["ipfs://base-icon"],
        },
      ],
    });
    const [approval] = await runtime.wallet.approvals.list();
    assert(approval?.type === "addNetwork");
    expect(fetch).not.toHaveBeenCalled();

    await runtime.wallet.approvals.approve({ approvalId: approval.approvalId, type: "addNetwork" });
    await expect(request).resolves.toBeNull();
    expect(fetch.mock.calls.map(([endpoint]) => endpoint)).toEqual([defaultEndpoint]);
    const [network] = await persistence.readers.customNetworks.listAll();
    expect(network).toMatchObject({
      definition: { chainRef, blockExplorers: explorerUrls.map((url) => ({ url })) },
    });
    expect(network?.definition).not.toHaveProperty("iconUrl");

    await runtime.wallet.networks.updateRpcEndpoints({
      chainRef,
      update: { type: "replace", index: 0, expectedUrl: defaultEndpoint, url: overrideEndpoint },
    });
    await runtime.wallet.networks.updateCustom({ chainRef, changes: { name: "Base Mainnet" } });
    const removedSite = { ...scope, chainRef } as const;
    const otherSite = { origin: "https://other-site.example", namespace: "eip155", chainRef: "eip155:10" } as const;
    await persistence.writer.commit([removedSite, otherSite].map(persistenceTypes.dappNetworkSelection.put));
    await runtime.wallet.lock();
    await persistence.close();

    fetch.mockClear();
    const { runtime: restored, persistence: restoredPersistence } = await open(databaseName);
    expect(fetch).not.toHaveBeenCalled();
    await expect(restored.wallet.networks.get(chainRef)).resolves.toMatchObject({ name: "Base Mainnet" });
    await expect(restored.wallet.networks.getRpcConfiguration(chainRef)).resolves.toEqual({
      source: "override",
      endpoints: [overrideEndpoint],
      defaultEndpoints: [defaultEndpoint],
    });
    restored.dappConnections.openConnection(scope);
    await expect(restored.dappConnections.request({ scope, method: "eth_blockNumber" })).resolves.toBe("0x1234");
    expect(fetch.mock.calls.map(([endpoint]) => endpoint)).toEqual([overrideEndpoint]);

    await restored.wallet.networks.removeCustom(chainRef);
    const { customNetworks, networkRpcOverrides, dappNetworkSelections } = restoredPersistence.readers;
    await expect(customNetworks.listAll()).resolves.toEqual([]);
    await expect(networkRpcOverrides.listAll()).resolves.toEqual([]);
    await expect(dappNetworkSelections.listAll()).resolves.toEqual([otherSite]);
  });

  it("rejects incomplete personal message bytes and signs empty data only after authorization and approval", async () => {
    const { runtime } = await open();
    const wallet = runtime.wallet;
    const created = await wallet.createFromPrivateKey({
      password: "password",
      namespace: "eip155",
      privateKey: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    });
    assert(created.status === "initialized");
    const [account] = (await wallet.accounts.getGroup(created.accountGroupId)).accounts;
    const address = "0xfcad0b19bb29d4674531d6f115237e16afce377c";
    const scope = { origin: "https://signing.example", namespace: "eip155" } as const;
    runtime.dappConnections.openConnection(scope);
    const params = ["0x", address] as const;
    await expect(runtime.dappConnections.request({ scope, method: "personal_sign", params })).rejects.toMatchObject({
      code: "global.rpc.unauthorized",
    });

    await wallet.permissions.setAccounts({ ...scope, accountIds: [account.accountId] });
    await expect(
      runtime.dappConnections.request({ scope, method: "personal_sign", params: ["0xa", address] }),
    ).rejects.toMatchObject({ code: "global.rpc.invalid_params" });
    expect(await wallet.approvals.list()).toEqual([]);

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
