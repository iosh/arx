import type { Eip155TransactionPayload } from "../../../types.js";
import type { Eip155PrepareContext, Eip155TrackingContext } from "../types.js";

import { TEST_ADDRESSES, TEST_CHAINS, TEST_TX_HASH, TEST_VALUES } from "./constants.js";

/**
 * Creates a minimal EIP-155 transaction request for testing.
 */
export const createEip155Request = (
  overrides: Partial<Eip155TransactionPayload> = {},
): Eip155PrepareContext["request"] => ({
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
export const createPrepareContext = (overrides: Partial<Eip155PrepareContext> = {}): Eip155PrepareContext => {
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
export const createBroadcasterContext = (overrides: Partial<Eip155PrepareContext> = {}): Eip155PrepareContext => {
  const baseRequest: Eip155PrepareContext["request"] = {
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
export const createReceiptContext = (overrides: Partial<Eip155TrackingContext> = {}): Eip155TrackingContext => ({
  recordId: "record-1",
  namespace: "eip155",
  chainRef: TEST_CHAINS.MAINNET,
  origin: "https://dapp.example",
  from: TEST_ADDRESSES.ACCOUNT_AA,
  submitted: {
    hash: TEST_TX_HASH,
    chainId: TEST_CHAINS.MAINNET_CHAIN_ID,
    from: TEST_ADDRESSES.ACCOUNT_AA,
    nonce: "0x3",
  },
  ...overrides,
});
