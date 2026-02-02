import type { Hex } from "ox/Hex";
import type { PreparedTransactionResult } from "../types.js";

export type Eip155FeeMode = "legacy" | "eip1559" | "unknown";
export type Eip155CallParams = {
  from?: Hex;
  to?: Hex;
  value?: Hex;
  data?: Hex;
};

export type Eip155PreparedTransaction = {
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
};

export type Eip155PreparedTransactionResult = PreparedTransactionResult<Eip155PreparedTransaction>;

// Resolver result types for testing and internal use
export type AddressResolutionResult = {
  prepared: Pick<Eip155PreparedTransaction, "from" | "to">;
};

export type FieldResolutionResult = {
  prepared: Partial<Eip155PreparedTransaction>;
  payloadValues: Partial<
    Pick<Eip155PreparedTransaction, "gas" | "gasPrice" | "maxFeePerGas" | "maxPriorityFeePerGas" | "nonce">
  >;
};

export type GasResolutionResult = {
  prepared: Partial<Pick<Eip155PreparedTransaction, "nonce" | "gas">>;
};

export type FeeResolutionResult = {
  prepared: Partial<Pick<Eip155PreparedTransaction, "gasPrice" | "maxFeePerGas" | "maxPriorityFeePerGas">>;
};
