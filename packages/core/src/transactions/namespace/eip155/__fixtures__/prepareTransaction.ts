import { vi } from "vitest";
import { eip155AddressCodec } from "../../../../chains/eip155/addressCodec.js";
import { ChainAddressCodecRegistry } from "../../../../chains/registry.js";
import type { Eip155FeeOracle, Eip155FeeSuggestion } from "../feeOracle.js";
import { createEip155PrepareTransaction } from "../prepareTransaction.js";
import type { Eip155PrepareResult } from "../types.js";
import type { Eip155UnsignedTransaction, Eip155UnsignedTransactionDraft } from "../unsignedTransaction.js";

/**
 * Creates a test-ready transaction preparer with sensible defaults.
 *
 * This factory encapsulates the common setup needed for testing transaction preparation,
 * reducing boilerplate in individual test files.
 *
 * @param overrides - Partial configuration to override defaults
 * @returns Configured prepareTransaction function
 */
export const createTestPrepareTransaction = (
  overrides: Partial<Parameters<typeof createEip155PrepareTransaction>[0]> = {},
) => {
  return createEip155PrepareTransaction({
    chains: new ChainAddressCodecRegistry([eip155AddressCodec]),
    rpcClientFactory: vi.fn(),
    feeOracleFactory: (_rpc) => {
      const suggestion = {
        mode: "legacy",
        gasPrice: "0x3b9aca00",
        source: "eth_gasPrice",
      } as const satisfies Eip155FeeSuggestion;

      const oracle: Eip155FeeOracle = {
        suggestFees: vi.fn(async () => suggestion) as unknown as Eip155FeeOracle["suggestFees"],
      };

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
  return result.status === "ready" ? result.prepared : (result.reviewSnapshot ?? {});
};
