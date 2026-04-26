import * as Hex from "ox/Hex";
import type { Eip155RpcCapabilities } from "../../../../rpc/namespaceClients/eip155.js";
import type { Eip155CallParams, Eip155PrepareStepResult, GasResolutionResult } from "../types.js";
import { Eip155FieldParseError, parseOptionalHexQuantity, readErrorMessage } from "../utils/validation.js";

type GasResolverParams = {
  rpc: Eip155RpcCapabilities | null;
  callParams: Eip155CallParams;
  gasProvided?: Hex.Hex | null;
  nonceProvided?: Hex.Hex | null;
};

export const deriveGas = async (
  params: GasResolverParams,
): Promise<Eip155PrepareStepResult<GasResolutionResult["prepared"]>> => {
  const prepared: GasResolutionResult["prepared"] = {};

  if (!params.nonceProvided && params.rpc && params.callParams.from) {
    try {
      const fetchedNonce = await params.rpc.getTransactionCount(params.callParams.from, { blockTag: "pending" });
      const nonceHex = parseOptionalHexQuantity(fetchedNonce, "nonce");
      if (nonceHex) {
        prepared.nonce = nonceHex;
      }
    } catch (error) {
      if (error instanceof Eip155FieldParseError) {
        return { status: "failed", error: error.toProposalError(), patch: prepared };
      }
      return {
        status: "failed",
        error: {
          reason: "transaction.prepare.nonce_failed",
          message: "Failed to fetch nonce from RPC.",
          data: {
            method: "eth_getTransactionCount",
            error: readErrorMessage(error),
          },
        },
        patch: prepared,
      };
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
      const gasHex = parseOptionalHexQuantity(estimatedGas, "gas");
      if (gasHex) {
        prepared.gas = gasHex;
        const gasValue = Hex.toBigInt(gasHex);
        if (gasValue === 0n) {
          return {
            status: "blocked",
            blocker: {
              reason: "transaction.prepare.gas_zero",
              message: "RPC returned gas=0x0, please confirm manually.",
              data: { estimate: estimatedGas },
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
          reason: "transaction.prepare.gas_estimation_failed",
          message: "Failed to estimate gas.",
          data: {
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
