import { describe, expect, it } from "vitest";
import type { TransactionApprovalReviewContext } from "../types.js";
import { TEST_ADDRESSES, TEST_CHAINS, TEST_VALUES } from "./__fixtures__/constants.js";
import { buildEip155ApprovalReview } from "./approvalReview.js";

describe("buildEip155ApprovalReview", () => {
  it("builds review from the proposal-review context only", () => {
    const context: TransactionApprovalReviewContext = {
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
        },
      },
      reviewPreparedSnapshot: {
        gas: TEST_VALUES.STANDARD_GAS_LIMIT,
      },
    };

    const review = buildEip155ApprovalReview(context);

    expect(review).toEqual({
      namespace: "eip155",
      summary: {
        from: TEST_ADDRESSES.FROM_A,
        to: TEST_ADDRESSES.TO_B,
        value: TEST_VALUES.ZERO,
        data: undefined,
      },
      execution: {
        gas: TEST_VALUES.STANDARD_GAS_LIMIT,
        gasPrice: undefined,
        maxFeePerGas: undefined,
        maxPriorityFeePerGas: undefined,
      },
    });
  });
});
