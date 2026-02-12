import * as Hex from "ox/Hex";
import type { Eip155RpcCapabilities } from "../../../../rpc/namespaceClients/eip155.js";
import type { Eip155CallParams, Eip155PreparedTransactionResult, GasResolutionResult } from "../types.js";
import { parseHexQuantity, pushIssue, pushWarning, readErrorMessage } from "../utils/validation.js";

type GasResolverParams = {
  rpc: Eip155RpcCapabilities | null;
  callParams: Eip155CallParams;
  gasProvided?: Hex.Hex | null;
  nonceProvided?: Hex.Hex | null;
};

export const deriveGas = async (
  params: GasResolverParams,
  issues: Eip155PreparedTransactionResult["issues"],
  warnings: Eip155PreparedTransactionResult["warnings"],
): Promise<GasResolutionResult> => {
  const prepared: GasResolutionResult["prepared"] = {};

  if (!params.nonceProvided && params.rpc && params.callParams.from) {
    try {
      const fetchedNonce = await params.rpc.getTransactionCount(params.callParams.from, { blockTag: "pending" });
      const nonceHex = parseHexQuantity(issues, fetchedNonce, "nonce");
      if (nonceHex) {
        prepared.nonce = nonceHex;
      }
    } catch (error) {
      pushIssue(issues, "transaction.prepare.nonce_failed", "Failed to fetch nonce from RPC.", {
        method: "eth_getTransactionCount",
        error: readErrorMessage(error),
      });
    }
  }

  if (!params.gasProvided && params.rpc) {
    try {
      const estimateArgs: Eip155CallParams = {};
      if (params.callParams.from) estimateArgs.from = params.callParams.from;
      if (params.callParams.to) estimateArgs.to = params.callParams.to;
      if (params.callParams.value) estimateArgs.value = params.callParams.value;
      if (params.callParams.data) estimateArgs.data = params.callParams.data;

      const estimatedGas = await params.rpc.estimateGas(estimateArgs);
      const gasHex = parseHexQuantity(issues, estimatedGas, "gas");
      if (gasHex) {
        const gasValue = Hex.toBigInt(gasHex);
        if (gasValue === BigInt(0)) {
          pushIssue(issues, "transaction.prepare.gas_zero", "RPC returned gas=0x0, please confirm manually.", {
            estimate: estimatedGas,
          });
        } else if (gasValue > BigInt(50_000_000)) {
          pushWarning(warnings, "transaction.prepare.gas_suspicious", "Estimated gas looks unusually high.", {
            estimate: estimatedGas,
          });
        }
        prepared.gas = gasHex;
      }
    } catch (error) {
      pushIssue(issues, "transaction.prepare.gas_estimation_failed", "Failed to estimate gas.", {
        method: "eth_estimateGas",
        error: readErrorMessage(error),
      });
    }
  }

  return { prepared };
};
