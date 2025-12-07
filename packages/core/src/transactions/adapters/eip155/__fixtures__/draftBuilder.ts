import { vi } from "vitest";
import { createDefaultChainModuleRegistry } from "../../../../chains/registry.js";
import { createEip155DraftBuilder } from "../draftBuilder.js";

/**
 * Creates a test-ready draft builder with sensible defaults
 *
 * This factory encapsulates the common setup needed for testing the draft builder,
 * reducing boilerplate in individual test files.
 *
 * @param overrides - Partial configuration to override defaults
 * @returns Configured draft builder instance
 */
export const createTestDraftBuilder = (overrides: Partial<Parameters<typeof createEip155DraftBuilder>[0]> = {}) => {
  return createEip155DraftBuilder({
    chains: createDefaultChainModuleRegistry(),
    rpcClientFactory: vi.fn(),
    ...overrides,
  });
};
