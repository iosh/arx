import { vi } from "vitest";
import type { Eip155RpcClient } from "../../../../rpc/namespaceClients/eip155.js";

/**
 * Creates a mock EIP-155 RPC client with spy functions
 *
 * Returns both the client object and individual spy functions for easy assertion.
 * Useful when you need to verify specific RPC calls in your tests.
 *
 * @example
 * const { client, estimateGas } = createEip155RpcMock();
 * estimateGas.mockResolvedValueOnce("0x5208");
 * // ... use client in test
 * expect(estimateGas).toHaveBeenCalledWith(...);
 */
export const createEip155RpcMock = (): {
  client: Eip155RpcClient;
  request: ReturnType<typeof vi.fn>;
  estimateGas: ReturnType<typeof vi.fn>;
  getBalance: ReturnType<typeof vi.fn>;
  getTransactionCount: ReturnType<typeof vi.fn>;
  getGasPrice: ReturnType<typeof vi.fn>;
  getMaxPriorityFeePerGas: ReturnType<typeof vi.fn>;
  getFeeHistory: ReturnType<typeof vi.fn>;
  getBlockByNumber: ReturnType<typeof vi.fn>;
  getTransactionReceipt: ReturnType<typeof vi.fn>;
  sendRawTransaction: ReturnType<typeof vi.fn>;
} => {
  const request = vi.fn();
  const estimateGas = vi.fn();
  const getBalance = vi.fn();
  const getTransactionCount = vi.fn();
  const getGasPrice = vi.fn();
  const getMaxPriorityFeePerGas = vi.fn();
  const getFeeHistory = vi.fn();
  const getBlockByNumber = vi.fn();
  const getTransactionReceipt = vi.fn();
  const sendRawTransaction = vi.fn();

  const client = {
    request,
    estimateGas,
    getBalance,
    getTransactionCount,
    getGasPrice,
    getMaxPriorityFeePerGas,
    getFeeHistory,
    getBlockByNumber,
    getTransactionReceipt,
    sendRawTransaction,
  } as unknown as Eip155RpcClient;

  return {
    client,
    request,
    estimateGas,
    getBalance,
    getTransactionCount,
    getGasPrice,
    getMaxPriorityFeePerGas,
    getFeeHistory,
    getBlockByNumber,
    getTransactionReceipt,
    sendRawTransaction,
  };
};

/**
 * Creates a simple mock RPC client with default implementations
 *
 * All methods return minimal valid responses. Override specific methods
 * using the overrides parameter.
 *
 * @param overrides - Partial client to override default implementations
 * @example
 * const client = createEip155RpcClient({
 *   estimateGas: vi.fn(async () => "0x5208"),
 * });
 */
export const createEip155RpcClient = (overrides: Partial<Eip155RpcClient> = {}): Eip155RpcClient => {
  return {
    request: vi.fn(async () => null),
    estimateGas: vi.fn(async () => "0x0"),
    getBalance: vi.fn(async () => "0x0"),
    getTransactionCount: vi.fn(async () => "0x0"),
    getGasPrice: vi.fn(async () => "0x0"),
    getMaxPriorityFeePerGas: vi.fn(async () => "0x0"),
    getFeeHistory: vi.fn(async () => ({ baseFeePerGas: [], gasUsedRatio: [], oldestBlock: "0x0" })),
    getBlockByNumber: vi.fn(async () => ({})),
    getTransactionReceipt: vi.fn(async () => null),
    sendRawTransaction: vi.fn(async () => "0x0"),
    ...overrides,
  } as unknown as Eip155RpcClient;
};

/**
 * Creates a mock RPC client factory for broadcaster tests
 *
 * Useful for testing transaction broadcasting where you need to control
 * the sendRawTransaction behavior.
 *
 * @param sendRawTransactionImpl - Custom implementation for sendRawTransaction
 */
export const createEip155BroadcasterFactory = (sendRawTransactionImpl: (raw: string) => Promise<string>) => {
  return vi.fn((_chainRef: string) => ({
    request: vi.fn(async () => null),
    estimateGas: vi.fn(),
    getBalance: vi.fn(),
    getTransactionCount: vi.fn(),
    getGasPrice: vi.fn(),
    getMaxPriorityFeePerGas: vi.fn(),
    getFeeHistory: vi.fn(),
    getBlockByNumber: vi.fn(),
    getTransactionReceipt: vi.fn(),
    sendRawTransaction: vi.fn(sendRawTransactionImpl),
  })) as unknown as (chainRef: string) => Eip155RpcClient;
};
