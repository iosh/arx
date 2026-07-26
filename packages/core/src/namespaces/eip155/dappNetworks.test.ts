import { describe, expect, it, vi } from "vitest";
import { Approvals } from "../../approvals/Approvals.js";
import type { AddNetworkApproval, SwitchNetworkApproval } from "../../approvals/types.js";
import type { Network } from "../../networks/types.js";
import { createEip155DappNetworkHandlers } from "./dappNetworks.js";

const ORIGIN = "https://dapp.example";
const ETHEREUM: Network = {
  chainRef: "eip155:1",
  namespace: "eip155",
  source: "builtin",
  name: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};
const OPTIMISM: Network = {
  chainRef: "eip155:10",
  namespace: "eip155",
  source: "builtin",
  name: "Optimism",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};
const BASE_REQUEST = {
  chainId: "0x2105",
  chainName: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://mainnet.base.org"],
};

const createHarness = () => {
  const installed = new Map([ETHEREUM, OPTIMISM].map((network) => [network.chainRef, network]));
  const approvals = new Approvals({
    time: {
      now: () => 1,
      schedule: () => () => {},
    },
    publishChanged: () => {},
  });
  const addCustom = vi.fn(async (input) => {
    installed.set(input.definition.chainRef, {
      ...input.definition,
      namespace: "eip155",
      source: "custom",
    });
  });
  const selectNetwork = vi.fn(async () => {});
  const handlers = createEip155DappNetworkHandlers({
    networks: {
      get: (chainRef) => installed.get(chainRef) ?? null,
      addCustom,
    },
    dappConnections: { selectNetwork },
    approvals,
  });

  const request = (method: "wallet_switchEthereumChain" | "wallet_addEthereumChain", params: unknown) =>
    handlers[method === "wallet_switchEthereumChain" ? "switchEthereumChain" : "addEthereumChain"]({
      origin: ORIGIN,
      chainRef: ETHEREUM.chainRef,
      method,
      params,
    });
  const approval = async <TType extends "switchNetwork" | "addNetwork">(type: TType) => {
    await vi.waitFor(() => expect(approvals.list()).toHaveLength(1));
    const approval = approvals.list()[0];
    if (approval?.type !== type) throw new Error(`Expected a ${type} approval.`);
    approvals.approve({ approvalId: approval.approvalId, type });
    return approval as Extract<SwitchNetworkApproval | AddNetworkApproval, { type: TType }>;
  };

  return { approvals, addCustom, selectNetwork, request, approval };
};

describe("EIP-155 dapp networks", () => {
  it("switches only known networks after approval", async () => {
    const harness = createHarness();

    await expect(harness.request("wallet_switchEthereumChain", [{ chainId: "0x1" }])).resolves.toBeNull();
    await expect(harness.request("wallet_switchEthereumChain", [{ chainId: "0x99" }])).rejects.toMatchObject({
      code: "global.rpc.unrecognized_chain",
    });
    expect(harness.approvals.list()).toEqual([]);

    const pending = harness.request("wallet_switchEthereumChain", [{ chainId: "0xa" }]);
    const approval = await harness.approval("switchNetwork");
    expect(approval.request).toEqual({ currentNetwork: ETHEREUM, targetNetwork: OPTIMISM });
    await expect(pending).resolves.toBeNull();
    expect(harness.selectNetwork).toHaveBeenCalledWith({
      origin: ORIGIN,
      namespace: "eip155",
      chainRef: OPTIMISM.chainRef,
    });
  });

  it("does not update installed networks and adds unknown networks only after approval", async () => {
    const harness = createHarness();
    const ethereumRequest = {
      ...BASE_REQUEST,
      chainId: "0x1",
      chainName: "Different Ethereum Metadata",
    };

    await expect(harness.request("wallet_addEthereumChain", [ethereumRequest])).resolves.toBeNull();
    expect(harness.addCustom).not.toHaveBeenCalled();
    expect(harness.approvals.list()).toEqual([]);

    const pending = harness.request("wallet_addEthereumChain", [BASE_REQUEST]);
    const approval = await harness.approval("addNetwork");
    expect(harness.addCustom).not.toHaveBeenCalled();
    expect(approval.request.definition.chainRef).toBe("eip155:8453");

    await expect(pending).resolves.toBeNull();
    expect(harness.addCustom).toHaveBeenCalledWith(approval.request);
  });
});
