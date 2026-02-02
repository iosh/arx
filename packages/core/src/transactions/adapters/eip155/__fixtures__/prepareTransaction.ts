import { vi } from "vitest";
import { createDefaultChainModuleRegistry } from "../../../../chains/registry.js";
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
    chains: createDefaultChainModuleRegistry(),
    rpcClientFactory: vi.fn(),
    ...overrides,
  });
};
