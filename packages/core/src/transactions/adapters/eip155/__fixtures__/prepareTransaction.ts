import { vi } from "vitest";
import { createDefaultChainDescriptorRegistry } from "../../../../chains/registry.js";
import type { Eip155FeeOracle, Eip155FeeSuggestion } from "../feeOracle.js";
import { createEip155PrepareTransaction } from "../prepareTransaction.js";

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
    chains: createDefaultChainDescriptorRegistry(),
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
