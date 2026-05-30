import type { Hex } from "ox/Hex";
import type { AccountAddress } from "../../../controllers/account/types.js";
import type { Eip155TransactionCoreFields } from "./unsignedTransaction.js";

export type Eip155TransactionAccessListEntry = {
  address: AccountAddress;
  storageKeys: Hex[];
};

/** JSON form of an EIP-155 transaction request before approval. */
export type Eip155TransactionPayload = {
  chainId?: Hex;
  from?: AccountAddress;
  to?: AccountAddress | null;
  value?: Hex;
  data?: Hex;
  gas?: Hex;
  gasPrice?: Hex;
  maxFeePerGas?: Hex;
  maxPriorityFeePerGas?: Hex;
  nonce?: Hex;
};

/** Request payload with a resolved sender. */
export type Eip155TransactionPayloadWithFrom = Eip155TransactionPayload & { from: AccountAddress };

/** One editable field change from the approval screen. */
export type Eip155TransactionDraftChange = {
  field: "gas" | "gasPrice" | "maxFeePerGas" | "maxPriorityFeePerGas" | "nonce";
  value: string | null;
};

export type Eip155TransactionDraftEdit = {
  namespace: "eip155";
  changes: readonly Eip155TransactionDraftChange[];
};

/** Durable JSON form of the submitted transaction facts. */
export type Eip155SubmittedTransaction = Eip155TransactionCoreFields & {
  hash: Hex;
  type?: Hex | null;
  gasPrice?: Hex | null;
  maxFeePerGas?: Hex | null;
  maxPriorityFeePerGas?: Hex | null;
  accessList?: Eip155TransactionAccessListEntry[];
};

/** JSON receipt shape kept on the transaction record. */
export type Eip155TransactionReceipt = {
  status?: Hex;
  transactionHash?: Hex;
  blockNumber?: Hex;
  [key: string]: unknown;
};
