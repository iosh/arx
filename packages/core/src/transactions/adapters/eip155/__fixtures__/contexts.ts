import type { Eip155TransactionPayload } from "../../../types.js";
import type { TransactionPrepareContext } from "../../types.js";

import { TEST_ADDRESSES, TEST_CHAINS, TEST_VALUES } from "./constants.js";

/**
 * Creates a minimal EIP-155 transaction request for testing.
 */
export const createEip155Request = (
  overrides: Partial<Eip155TransactionPayload> = {},
): TransactionPrepareContext["request"] => ({
  namespace: "eip155",
  chainRef: TEST_CHAINS.MAINNET,
  payload: {
    from: TEST_ADDRESSES.FROM_A,
    to: TEST_ADDRESSES.TO_B,
    value: TEST_VALUES.ONE_ETH,
    data: TEST_VALUES.EMPTY_DATA,
    chainId: TEST_CHAINS.MAINNET_CHAIN_ID,
    ...overrides,
  },
});

/**
 * Creates a complete transaction prepare context for testing.
 */
export const createPrepareContext = (overrides: Partial<TransactionPrepareContext> = {}): TransactionPrepareContext => {
  const request = overrides.request ?? createEip155Request();

  return {
    namespace: "eip155",
    chainRef: TEST_CHAINS.MAINNET,
    origin: "https://dapp.example",
    from: TEST_ADDRESSES.FROM_A,
    request,
    ...overrides,
  };
};

/**
 * Creates a context for broadcaster tests.
 */
export const createBroadcasterContext = (
  overrides: Partial<TransactionPrepareContext> = {},
): TransactionPrepareContext => {
  const baseRequest: TransactionPrepareContext["request"] = {
    namespace: "eip155",
    chainRef: TEST_CHAINS.MAINNET,
    payload: {
      from: TEST_ADDRESSES.ACCOUNT_AA,
    },
  };

  return createPrepareContext({
    from: TEST_ADDRESSES.ACCOUNT_AA,
    request: baseRequest,
    ...overrides,
  });
};

/**
 * Creates a context for receipt tests (transaction is already broadcast).
 */
export const createReceiptContext = (overrides: Partial<TransactionPrepareContext> = {}): TransactionPrepareContext => {
  const baseRequest: TransactionPrepareContext["request"] = {
    namespace: "eip155",
    chainRef: TEST_CHAINS.MAINNET,
    payload: {
      from: TEST_ADDRESSES.ACCOUNT_AA,
      to: TEST_ADDRESSES.ACCOUNT_BB,
      nonce: "0x3",
      value: TEST_VALUES.ZERO,
      data: TEST_VALUES.EMPTY_DATA,
    },
  };

  return createPrepareContext({
    from: TEST_ADDRESSES.ACCOUNT_AA,
    request: baseRequest,
    ...overrides,
  });
};
