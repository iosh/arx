import { describe, expect, it } from "vitest";
import { TEST_ADDRESSES, TEST_CHAINS, TEST_VALUES } from "./__fixtures__/constants.js";
import { buildEip155ApprovalReview } from "./approvalReview.js";
import type { Eip155ApprovalReviewContext } from "./types.js";

describe("buildEip155ApprovalReview", () => {
  it("builds review details from request and prepared review snapshot", () => {
    const context: Eip155ApprovalReviewContext = {
      transactionId: "proposal-1",
      namespace: "eip155",
      chainRef: TEST_CHAINS.MAINNET,
      origin: "https://dapp.example",
      from: TEST_ADDRESSES.FROM_A,
      request: {
        namespace: "eip155",
        chainRef: TEST_CHAINS.MAINNET,
        payload: {
          from: TEST_ADDRESSES.FROM_A,
          to: TEST_ADDRESSES.TO_B,
          value: TEST_VALUES.ZERO,
          data: "0xabcdef",
          gasPrice: TEST_VALUES.GAS_PRICE_1GWEI,
        },
      },
      reviewSnapshot: {
        gas: TEST_VALUES.STANDARD_GAS_LIMIT,
        maxFeePerGas: TEST_VALUES.MAX_FEE_1_5GWEI,
        maxPriorityFeePerGas: TEST_VALUES.PRIORITY_FEE_1GWEI,
      },
    };

    const review = buildEip155ApprovalReview(context);

    expect(review).toEqual({
      namespace: "eip155",
      kind: "contract_interaction",
      from: TEST_ADDRESSES.FROM_A,
      to: TEST_ADDRESSES.TO_B,
      value: TEST_VALUES.ZERO,
      data: "0xabcdef",
      nonce: null,
      gasLimit: TEST_VALUES.STANDARD_GAS_LIMIT,
      fees: {
        gasPrice: TEST_VALUES.GAS_PRICE_1GWEI,
        maxFeePerGas: TEST_VALUES.MAX_FEE_1_5GWEI,
        maxPriorityFeePerGas: TEST_VALUES.PRIORITY_FEE_1GWEI,
      },
    });
  });
});
