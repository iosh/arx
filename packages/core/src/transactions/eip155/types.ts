import type { Hex } from "ox/Hex";

export type Fee =
  | Readonly<{ type: "legacy"; gasPrice: Hex }>
  | Readonly<{
      type: "eip1559";
      maxFeePerGas: Hex;
      maxPriorityFeePerGas: Hex;
    }>;

export type PreparedTransaction = Readonly<{
  from: string;
  to: string | null;
  value: Hex;
  data: Hex;
  gas: Hex;
  nonce?: Hex;
  fee: Fee;
}>;
