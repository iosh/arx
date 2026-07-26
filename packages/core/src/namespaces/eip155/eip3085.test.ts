import { describe, expect, it } from "vitest";
import { decodeAddEthereumChainParams } from "./eip3085.js";

const baseRequest = {
  chainId: "0x2105",
  chainName: "Base",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: ["https://mainnet.base.org", "https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
  iconUrls: ["https://base.org/icon.png"],
};

describe("EIP-3085 chain import", () => {
  it("projects wallet_addEthereumChain params to a custom network input", () => {
    const input = decodeAddEthereumChainParams([baseRequest], "wallet_addEthereumChain");

    expect(input.definition).toEqual({
      chainRef: "eip155:8453",
      name: "Base",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      blockExplorers: [{ url: "https://basescan.org" }],
    });
    expect(input.defaultRpcEndpoints).toEqual(["https://mainnet.base.org"]);
  });

  it("allows only HTTPS or loopback HTTP RPC endpoints", () => {
    for (const rpcUrl of ["http://mainnet.base.org", "wss://mainnet.base.org"]) {
      expect(() =>
        decodeAddEthereumChainParams(
          [
            {
              ...baseRequest,
              rpcUrls: [rpcUrl],
            },
          ],
          "wallet_addEthereumChain",
        ),
      ).toThrow();
    }

    const input = decodeAddEthereumChainParams(
      [{ ...baseRequest, rpcUrls: ["http://localhost:8545"] }],
      "wallet_addEthereumChain",
    );

    expect(input.defaultRpcEndpoints).toEqual(["http://localhost:8545"]);
  });
});
