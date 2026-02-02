import type { Eip155TransactionPayload, TransactionMeta } from "../../../../controllers/transaction/types.js";
import type { TransactionAdapterContext } from "../../types.js";

import { TEST_ADDRESSES, TEST_CHAINS, TEST_VALUES } from "./constants.js";

/**
 * Creates a minimal EIP-155 transaction request for testing
 */
export const createEip155Request = (
  overrides: Partial<Eip155TransactionPayload> = {},
): TransactionAdapterContext["request"] => ({
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
 * Creates a transaction metadata object for testing
 */
export const createTransactionMeta = (
  request: TransactionAdapterContext["request"],
  overrides: Partial<TransactionMeta> = {},
): TransactionMeta => ({
  id: "tx-1",
  namespace: "eip155",
  chainRef: TEST_CHAINS.MAINNET,
  origin: "https://dapp.example",
  from: TEST_ADDRESSES.FROM_A,
  request,
  prepared: null,
  status: "pending",
  hash: null,
  receipt: null,
  error: null,
  userRejected: false,
  warnings: [],
  issues: [],
  createdAt: 1_000,
  updatedAt: 1_000,
  ...overrides,
});

/**
 * Creates a complete transaction adapter context for testing
 */
export const createAdapterContext = (overrides: Partial<TransactionAdapterContext> = {}): TransactionAdapterContext => {
  const request = overrides.request ?? createEip155Request();
  const meta = overrides.meta ?? createTransactionMeta(request);

  return {
    namespace: "eip155",
    chainRef: TEST_CHAINS.MAINNET,
    origin: "https://dapp.example",
    from: TEST_ADDRESSES.FROM_A,
    meta,
    request,
    ...overrides,
  };
};

/**
 * Creates a context for broadcaster tests (transaction in approved state)
 */
export const createBroadcasterContext = (
  overrides: Partial<TransactionAdapterContext> = {},
): TransactionAdapterContext => {
  const baseRequest = {
    namespace: "eip155" as const,
    chainRef: TEST_CHAINS.MAINNET,
    payload: {
      from: TEST_ADDRESSES.ACCOUNT_AA,
    },
  };

  return createAdapterContext({
    from: TEST_ADDRESSES.ACCOUNT_AA,
    request: baseRequest,
    meta: createTransactionMeta(baseRequest, {
      from: TEST_ADDRESSES.ACCOUNT_AA,
      status: "approved",
    }),
    ...overrides,
  });
};

/**
 * Creates a context for receipt tests (transaction in broadcast state)
 */
export const createReceiptContext = (overrides: Partial<TransactionAdapterContext> = {}): TransactionAdapterContext => {
  const baseRequest = {
    namespace: "eip155" as const,
    chainRef: TEST_CHAINS.MAINNET,
    payload: {
      from: TEST_ADDRESSES.ACCOUNT_AA,
      to: TEST_ADDRESSES.ACCOUNT_BB,
      nonce: "0x3",
      value: TEST_VALUES.ZERO,
      data: TEST_VALUES.EMPTY_DATA,
    },
  };

  return createAdapterContext({
    from: TEST_ADDRESSES.ACCOUNT_AA,
    request: baseRequest,
    meta: createTransactionMeta(baseRequest, {
      from: TEST_ADDRESSES.ACCOUNT_AA,
      status: "broadcast",
    }),
    ...overrides,
  });
};
