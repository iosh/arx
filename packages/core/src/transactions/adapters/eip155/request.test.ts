import { describe, expect, it } from "vitest";
import { TEST_ADDRESSES, TEST_CHAINS, TEST_VALUES } from "./__fixtures__/constants.js";
import { deriveEip155HexChainIdFromChainRef, normalizeEip155TransactionRequest } from "./request.js";

describe("eip155 transaction request helpers", () => {
  it("derives a hex chainId from the chainRef reference", () => {
    expect(deriveEip155HexChainIdFromChainRef(TEST_CHAINS.SEPOLIA)).toBe("0xaa36a7");
  });

  it("injects chainId when the request omits it", () => {
    expect(
      normalizeEip155TransactionRequest(
        {
          namespace: "eip155",
          payload: {
            from: TEST_ADDRESSES.FROM_A,
            to: TEST_ADDRESSES.TO_B,
            value: TEST_VALUES.ONE_ETH,
            data: TEST_VALUES.EMPTY_DATA,
          },
        },
        TEST_CHAINS.MAINNET,
      ),
    ).toEqual({
      namespace: "eip155",
      chainRef: TEST_CHAINS.MAINNET,
      payload: {
        from: TEST_ADDRESSES.FROM_A,
        to: TEST_ADDRESSES.TO_B,
        value: TEST_VALUES.ONE_ETH,
        data: TEST_VALUES.EMPTY_DATA,
        chainId: TEST_CHAINS.MAINNET_CHAIN_ID,
      },
    });
  });

  it("preserves an explicit chainId", () => {
    expect(
      normalizeEip155TransactionRequest(
        {
          namespace: "eip155",
          payload: {
            from: TEST_ADDRESSES.FROM_A,
            chainId: "0xa",
          },
        },
        TEST_CHAINS.MAINNET,
      ),
    ).toEqual({
      namespace: "eip155",
      chainRef: TEST_CHAINS.MAINNET,
      payload: {
        from: TEST_ADDRESSES.FROM_A,
        chainId: "0xa",
      },
    });
  });
});
