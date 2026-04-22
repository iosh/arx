import type { Hex } from "ox/Hex";
import type { ChainRef } from "../chains/ids.js";
import type { AccountAddress } from "../controllers/account/types.js";

export type TransactionDiagnosticSeverity = "low" | "medium" | "high";

export type TransactionDiagnostic = {
  kind: "warning" | "issue";
  code: string;
  message: string;
  /**
   * Optional severity hint for UI treatment and decision-making.
   * - "warning" diagnostics may still be treated as blocking by the UI.
   * - "issue" diagnostics are blocking candidates by default.
   */
  severity?: TransactionDiagnosticSeverity;
  data?: unknown;
};

export type TransactionWarning = TransactionDiagnostic & { kind: "warning" };
export type TransactionIssue = TransactionDiagnostic & { kind: "issue" };

export type TransactionError = {
  name: string;
  message: string;
  code?: number | undefined;
  data?: unknown;
};

export type TransactionReceipt = Record<string, unknown>;
export type TransactionSubmitted = Record<string, unknown>;

export type TransactionPrepared = Record<string, unknown>;
export type TransactionPayload = Record<string, unknown>;

export type TransactionSubmissionLocator = {
  format: string;
  value: string;
};

export type Eip155TransactionAccessListEntry = {
  address: AccountAddress;
  storageKeys: Hex[];
};

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
export type Eip155TransactionPayloadWithFrom = Eip155TransactionPayload & { from: AccountAddress };
export type Eip155TransactionRequest = TransactionRequest<"eip155", Eip155TransactionPayload>;

export type Eip155SubmittedTransaction = {
  hash: Hex;
  chainId: Hex;
  from: AccountAddress;
  to?: AccountAddress | null;
  value?: Hex;
  data?: Hex;
  gas?: Hex;
  nonce: Hex;
  type?: Hex | null;
  gasPrice?: Hex | null;
  maxFeePerGas?: Hex | null;
  maxPriorityFeePerGas?: Hex | null;
  accessList?: Eip155TransactionAccessListEntry[];
};

export type TransactionRequest<
  TNamespace extends string = string,
  TPayload extends TransactionPayload = TransactionPayload,
> = {
  namespace: TNamespace;
  chainRef?: ChainRef | undefined;
  payload: TPayload;
};
