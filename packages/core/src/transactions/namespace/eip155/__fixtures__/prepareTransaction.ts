import { vi } from "vitest";
import type { ChainJsonRpc } from "../../../../chainJsonRpc/ChainJsonRpc.js";
import { buildChainAddressingByNamespace } from "../../../../chains/addressing.js";
import { eip155ChainAddressing } from "../../../../namespaces/eip155/chainAddressing.js";
import type { Eip155FeeOracle, Eip155FeeSuggestion } from "../feeOracle.js";
import { createEip155PrepareTransaction } from "../prepareTransaction.js";
import type { Eip155PrepareResult } from "../types.js";
import type { Eip155UnsignedTransaction, Eip155UnsignedTransactionDraft } from "../unsignedTransaction.js";

const defaultChainJsonRpc: ChainJsonRpc = {
  async request<TResult = unknown>({ method }): Promise<TResult> {
    const resultByMethod: Readonly<Record<string, unknown>> = {
      eth_estimateGas: "0x5208",
      eth_getBalance: "0xffffffffffffffff",
      eth_gasPrice: "0x3b9aca00",
      eth_maxPriorityFeePerGas: "0x3b9aca00",
      eth_getBlockByNumber: { baseFeePerGas: null },
    };
    return (resultByMethod[method] ?? null) as TResult;
  },
};

export const createTestPrepareTransaction = (
  overrides: Partial<Parameters<typeof createEip155PrepareTransaction>[0]> = {},
) => {
  const chainJsonRpc = overrides.chainJsonRpc ?? defaultChainJsonRpc;
  return createEip155PrepareTransaction({
    chains: buildChainAddressingByNamespace([eip155ChainAddressing]),
    chainJsonRpc,
    feeOracleFactory: (_rpc) => {
      const suggestion = {
        mode: "legacy",
        gasPrice: "0x3b9aca00",
        source: "eth_gasPrice",
      } as const satisfies Eip155FeeSuggestion;

      const oracle: Eip155FeeOracle = { suggestFees: vi.fn(async () => suggestion) };

      return oracle;
    },
    ...overrides,
  });
};

export const requireReadyPrepared = (result: Eip155PrepareResult): Eip155UnsignedTransaction => {
  if (result.status !== "ready") {
    throw new Error(`Expected ready prepare result, received ${result.status}`);
  }
  return result.prepared;
};

export const requirePartialPrepared = (result: Eip155PrepareResult): Eip155UnsignedTransactionDraft => {
  if (result.status === "ready") return result.prepared;
  if (result.reviewSnapshot === null) return {};
  return result.reviewSnapshot;
};
