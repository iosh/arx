import * as Hex from "ox/Hex";
import type { ChainJsonRpcClient } from "../../../../chainJsonRpc/ChainJsonRpc.js";
import type { ChainRef } from "../../../../chains/ids.js";
import type { Eip155CallParams, Eip155PrepareStepResult, GasResolutionResult } from "../types.js";
import { Eip155FieldParseError, parseOptionalHexQuantity, readErrorMessage } from "../utils/validation.js";

type GasResolverParams = {
  chainJsonRpc: ChainJsonRpcClient;
  chainRef: ChainRef;
  callParams: Eip155CallParams;
  gasProvided?: Hex.Hex | null;
};

export const deriveGas = async (
  params: GasResolverParams,
): Promise<Eip155PrepareStepResult<GasResolutionResult["prepared"]>> => {
  const prepared: GasResolutionResult["prepared"] = {};

  if (!params.gasProvided) {
    try {
      const estimateArgs: Eip155CallParams = {};
      if (params.callParams.from) estimateArgs.from = params.callParams.from;
      if (params.callParams.to) estimateArgs.to = params.callParams.to;
      if (params.callParams.value) estimateArgs.value = params.callParams.value;
      if (params.callParams.data) estimateArgs.data = params.callParams.data;

      const estimatedGas = await params.chainJsonRpc.request<string>({
        chainRef: params.chainRef,
        method: "eth_estimateGas",
        params: [estimateArgs],
      });
      const gasHex = parseOptionalHexQuantity(estimatedGas, "gas");
      if (gasHex) {
        prepared.gas = gasHex;
        const gasValue = Hex.toBigInt(gasHex);
        if (gasValue === 0n) {
          return {
            status: "blocked",
            blocker: {
              code: "transaction.prepare.gas_zero",
              message: "RPC returned gas=0x0, please confirm manually.",
              details: { estimate: estimatedGas },
            },
            patch: prepared,
          };
        }
      }
    } catch (error) {
      if (error instanceof Eip155FieldParseError) {
        return { status: "failed", error: error.toProposalError(), patch: prepared };
      }
      return {
        status: "failed",
        error: {
          code: "transaction.prepare.gas_estimation_failed",
          message: "Failed to estimate gas.",
          details: {
            method: "eth_estimateGas",
            error: readErrorMessage(error),
          },
        },
        patch: prepared,
      };
    }
  }

  return { status: "ok", patch: prepared };
};
