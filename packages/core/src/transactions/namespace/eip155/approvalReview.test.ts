import { describe, expect, it } from "vitest";
import { ApprovalKinds } from "../../../controllers/approval/types.js";
import type { TransactionProposalContext } from "../types.js";
import { TEST_ADDRESSES, TEST_CHAINS, TEST_VALUES } from "./__fixtures__/constants.js";
import { buildEip155ApprovalReview } from "./approvalReview.js";

const REQUEST = {
  chainRef: TEST_CHAINS.MAINNET,
  origin: "https://dapp.example",
  from: TEST_ADDRESSES.ACCOUNT_AA,
  request: {
    namespace: "eip155" as const,
    chainRef: TEST_CHAINS.MAINNET,
    payload: {
      from: TEST_ADDRESSES.ACCOUNT_AA,
      to: TEST_ADDRESSES.ACCOUNT_BB,
      value: TEST_VALUES.ONE_ETH,
      gas: TEST_VALUES.STANDARD_GAS_LIMIT,
    },
  },
};

describe("buildEip155ApprovalReview", () => {
  it("prefers proposal currentRequest over approval request payload", () => {
    const proposal: TransactionProposalContext = {
      proposalId: "proposal-1",
      namespace: "eip155",
      chainRef: TEST_CHAINS.MAINNET,
      origin: REQUEST.origin,
      from: TEST_ADDRESSES.FROM_A,
      currentRequest: {
        namespace: "eip155",
        chainRef: TEST_CHAINS.MAINNET,
        payload: {
          from: TEST_ADDRESSES.FROM_A,
          to: TEST_ADDRESSES.TO_B,
          value: TEST_VALUES.ZERO,
        },
      },
      prepared: null,
    };

    const review = buildEip155ApprovalReview({
      proposal,
      request: {
        kind: ApprovalKinds.SendTransaction,
        ...REQUEST,
      },
      reviewPreparedSnapshot: {
        gas: TEST_VALUES.STANDARD_GAS_LIMIT,
      },
    });

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
