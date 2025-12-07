import * as Hex from "ox/Hex";
import type { Eip155RpcCapabilities } from "../../../../rpc/clients/eip155/eip155.js";
import type { Eip155DraftPrepared, Eip155TransactionDraft, GasResolutionResult } from "../types.js";
import { normaliseHexQuantity, pushIssue, pushWarning, readErrorMessage } from "../utils/validation.js";

type GasResolverParams = {
  rpc: Eip155RpcCapabilities | null;
  callParams: Eip155DraftPrepared["callParams"];
  prepared: Partial<Pick<Eip155DraftPrepared, "gasPrice" | "maxFeePerGas" | "maxPriorityFeePerGas" | "nonce">>;
  gasProvided?: Hex.Hex | null;
  nonceProvided?: Hex.Hex | null;
};

export const resolveGas = async (
  params: GasResolverParams,
  issues: Eip155TransactionDraft["issues"],
  warnings: Eip155TransactionDraft["warnings"],
): Promise<GasResolutionResult> => {
  const prepared: GasResolutionResult["prepared"] = {};
  const summary: GasResolutionResult["summary"] = {};

  if (!params.nonceProvided && params.rpc && params.callParams.from) {
    try {
      const fetchedNonce = await params.rpc.getTransactionCount(params.callParams.from, "pending");
      const normalisedNonce = normaliseHexQuantity(issues, fetchedNonce, "nonce");
      if (normalisedNonce) {
        prepared.nonce = normalisedNonce;
        summary.nonce = normalisedNonce;
      }
    } catch (error) {
      pushIssue(issues, "transaction.draft.nonce_failed", "Failed to fetch nonce from RPC.", {
        method: "eth_getTransactionCount",
        error: readErrorMessage(error),
      });
    }
  }

  if (!params.gasProvided && params.rpc) {
    try {
      const estimateArgs: Record<string, Hex.Hex> = {};
      if (params.callParams.from) estimateArgs.from = params.callParams.from;
      if (params.callParams.to) estimateArgs.to = params.callParams.to;
      if (params.callParams.value) estimateArgs.value = params.callParams.value;
      if (params.callParams.data) estimateArgs.data = params.callParams.data;
      if (params.prepared.gasPrice) estimateArgs.gasPrice = params.prepared.gasPrice;
      if (params.prepared.maxFeePerGas) estimateArgs.maxFeePerGas = params.prepared.maxFeePerGas;
      if (params.prepared.maxPriorityFeePerGas)
        estimateArgs.maxPriorityFeePerGas = params.prepared.maxPriorityFeePerGas;

      const nonceForEstimate = prepared.nonce ?? params.prepared.nonce;
      if (nonceForEstimate) estimateArgs.nonce = nonceForEstimate;

      summary.estimateInput = estimateArgs;
      const estimatedGas = await params.rpc.estimateGas([estimateArgs]);
      const normalisedGas = normaliseHexQuantity(issues, estimatedGas, "gas");
      if (normalisedGas) {
        const gasValue = Hex.toBigInt(normalisedGas);
        if (gasValue === BigInt(0)) {
          pushIssue(issues, "transaction.draft.gas_zero", "RPC returned gas=0x0, please confirm manually.", {
            estimate: estimatedGas,
          });
        } else if (gasValue > BigInt(50_000_000)) {
          pushWarning(warnings, "transaction.draft.gas_suspicious", "Estimated gas looks unusually high.", {
            estimate: estimatedGas,
          });
        }
        prepared.gas = normalisedGas;
        summary.gas = normalisedGas;
      }
    } catch (error) {
      pushIssue(issues, "transaction.draft.gas_estimation_failed", "Failed to estimate gas.", {
        method: "eth_estimateGas",
        error: readErrorMessage(error),
      });
    }
  }

  return { prepared, summary };
};
