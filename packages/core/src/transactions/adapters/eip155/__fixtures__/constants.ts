// Test addresses used across EIP-155 adapter tests
export const TEST_ADDRESSES = {
  FROM_A: "0x1111111111111111111111111111111111111111" as const,
  TO_B: "0x2222222222222222222222222222222222222222" as const,
  ACCOUNT_AA: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const,
  ACCOUNT_BB: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const,
  MIXED_CASE: "0x52908400098527886E0F7030069857D2E4169EE7" as const,
} as const;

export const TEST_TX_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

// Common test values for transactions
export const TEST_VALUES = {
  ONE_ETH: "0xde0b6b3a7640000" as const, // 1 ETH in wei
  ZERO: "0x0" as const,
  EMPTY_DATA: "0x" as const,
  STANDARD_GAS_LIMIT: "0x5208" as const, // 21000 gas
  GAS_PRICE_1GWEI: "0x3b9aca00" as const,
  MAX_FEE_1_5GWEI: "0x59682f00" as const,
  PRIORITY_FEE_1GWEI: "0x3b9aca00" as const,
} as const;

// Chain identifiers for testing
export const TEST_CHAINS = {
  MAINNET: "eip155:1" as const,
  MAINNET_CHAIN_ID: "0x1" as const,
  SEPOLIA: "eip155:11155111" as const,
} as const;
