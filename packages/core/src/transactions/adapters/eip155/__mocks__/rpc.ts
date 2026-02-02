import { vi } from "vitest";
import type { Eip155RpcCapabilities } from "../../../../rpc/clients/eip155/eip155.js";

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
  client: Eip155RpcCapabilities;
  estimateGas: any;
  getTransactionCount: any;
  getFeeData: any;
  getTransactionReceipt: any;
  sendRawTransaction: any;
} => {
  const estimateGas = vi.fn();
  const getTransactionCount = vi.fn();
  const getFeeData = vi.fn();
  const getTransactionReceipt = vi.fn();
  const sendRawTransaction = vi.fn();

  const client: Eip155RpcCapabilities = {
    estimateGas: estimateGas as unknown as Eip155RpcCapabilities["estimateGas"],
    getTransactionCount: getTransactionCount as unknown as Eip155RpcCapabilities["getTransactionCount"],
    getFeeData: getFeeData as unknown as Eip155RpcCapabilities["getFeeData"],
    getTransactionReceipt: getTransactionReceipt as unknown as Eip155RpcCapabilities["getTransactionReceipt"],
    sendRawTransaction: sendRawTransaction as unknown as Eip155RpcCapabilities["sendRawTransaction"],
  };

  return { client, estimateGas, getTransactionCount, getFeeData, getTransactionReceipt, sendRawTransaction };
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
export const createEip155RpcClient = (overrides: Partial<Eip155RpcCapabilities> = {}): Eip155RpcCapabilities => {
  return {
    estimateGas: vi.fn(async () => "0x0"),
    getTransactionCount: vi.fn(async () => "0x0"),
    getFeeData: vi.fn(async () => ({})),
    getTransactionReceipt: vi.fn(async () => null),
    sendRawTransaction: vi.fn(async () => "0x0"),
    ...overrides,
  };
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
    estimateGas: vi.fn(),
    getTransactionCount: vi.fn(),
    getFeeData: vi.fn(),
    getTransactionReceipt: vi.fn(),
    sendRawTransaction: vi.fn(sendRawTransactionImpl),
  })) as unknown as (chainRef: string) => Eip155RpcCapabilities;
};
