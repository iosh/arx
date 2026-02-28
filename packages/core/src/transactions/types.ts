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

export type TransactionPrepared = Record<string, unknown>;

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

export type TransactionPayloadMap = {
  eip155: Eip155TransactionPayload;
};

export type TransactionRequest<TNamespace extends string = keyof TransactionPayloadMap | string> = {
  namespace: TNamespace;
  chainRef?: ChainRef | undefined;
  payload: TNamespace extends keyof TransactionPayloadMap ? TransactionPayloadMap[TNamespace] : Record<string, unknown>;
};
