import type { Hex } from "ox/Hex";
import type { TransactionDraft } from "../types.js";

export type Eip155FeeMode = "legacy" | "eip1559" | "unknown";
export type Eip155CallParams = {
  from?: Hex;
  to?: Hex;
  value?: Hex;
  data?: Hex;
};

export type Eip155DraftPrepared = {
  from?: Hex;
  to?: Hex | null;
  value?: Hex;
  data?: Hex;
  gas?: Hex;
  nonce?: Hex;
  chainId?: Hex;
  gasPrice?: Hex;
  maxFeePerGas?: Hex;
  maxPriorityFeePerGas?: Hex;
  callParams: Eip155CallParams;
};

export type Eip155DraftSummary = {
  generatedAt: number;
  namespace: "eip155";
  chainRef: string;
  rpcAvailable: boolean;
  from?: Hex;
  to?: Hex | null;
  expectedChainId?: Hex;
  chainId?: Hex;
  valueHex?: Hex;
  valueWei?: string;
  data?: Hex;
  gas?: Hex;
  nonce?: Hex;
  feeMode: Eip155FeeMode;
  fee?: { mode: "legacy"; gasPrice: Hex } | { mode: "eip1559"; maxFeePerGas: Hex; maxPriorityFeePerGas: Hex };
  maxCostWei?: string;
  maxCostHex?: Hex;
  callParams: Eip155CallParams;
  estimateInput?: Record<string, Hex>;
};

export type Eip155TransactionDraft = TransactionDraft<Eip155DraftPrepared, Eip155DraftSummary>;

// Resolver result types for testing and internal use
export type AddressResolutionResult = {
  prepared: Pick<Eip155DraftPrepared, "from" | "to">;
  summary: Pick<Eip155DraftSummary, "from" | "to">;
};

export type FieldResolutionResult = {
  prepared: Partial<Eip155DraftPrepared>;
  summary: Partial<Eip155DraftSummary>;
  payloadValues: Partial<
    Pick<Eip155DraftPrepared, "gas" | "gasPrice" | "maxFeePerGas" | "maxPriorityFeePerGas" | "nonce">
  >;
};

export type GasResolutionResult = {
  prepared: Partial<Pick<Eip155DraftPrepared, "nonce" | "gas">>;
  summary: Partial<Pick<Eip155DraftSummary, "nonce" | "gas" | "estimateInput">>;
};

export type FeeResolutionResult = {
  prepared: Partial<Pick<Eip155DraftPrepared, "gasPrice" | "maxFeePerGas" | "maxPriorityFeePerGas">>;
  summary: Partial<Pick<Eip155DraftSummary, "feeMode" | "fee" | "maxCostWei" | "maxCostHex">>;
};
