import { describe, expect, it, vi } from "vitest";
import { createChainJsonRpc } from "../chainJsonRpc/ChainJsonRpc.js";
import { createJsonRpcHttpTransport } from "../chainJsonRpc/JsonRpcHttpTransport.js";
import { ACCOUNT_ID, ADDRESS, createAccounts, createNetworks } from "../namespaces/eip155/__tests__/fixtures.js";
import { createEip155AssetsAdapter } from "../namespaces/eip155/assets.js";
import { createAssets } from "./Assets.js";

describe("asset balances", () => {
  it("reads the requested account's balance without losing integer precision", async () => {
    const networks = createNetworks();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_endpoint, input) => {
      const request = JSON.parse(input?.body as string) as { id: number };
      return Response.json({ jsonrpc: "2.0", id: request.id, result: "0x20000000000001" });
    });
    const chainJsonRpc = createChainJsonRpc({ endpoints: networks, transport: createJsonRpcHttpTransport({ fetch }) });
    const assets = createAssets({
      accounts: createAccounts(),
      networks,
      adapters: { eip155: createEip155AssetsAdapter({ chainJsonRpc }) },
    });

    await expect(assets.getBalances({ accountId: ACCOUNT_ID, chainRef: "eip155:1" })).resolves.toEqual([
      {
        assetId: "eip155:1/native",
        name: "Ether",
        symbol: "ETH",
        decimals: 18,
        balance: "9007199254740993",
      },
    ]);
    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      method: "eth_getBalance",
      params: [ADDRESS, "latest"],
    });
  });
});
