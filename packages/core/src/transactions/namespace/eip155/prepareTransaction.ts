import { ArxReasons, arxError } from "@arx/errors";
import type { ChainAddressCodecRegistry } from "../../../chains/registry.js";
import type { Eip155RpcClient } from "../../../rpc/namespaceClients/eip155.js";
import type { Eip155TransactionPayload } from "../../types.js";
import type { TransactionPrepareContext } from "../types.js";
import { createEip155FeeOracle, type Eip155FeeOracle } from "./feeOracle.js";
import { createAddressResolver } from "./resolvers/addressResolver.js";
import { checkBalanceForMaxCost } from "./resolvers/balanceResolver.js";
import { deriveFees } from "./resolvers/feeResolver.js";
import { deriveFields } from "./resolvers/fieldResolver.js";
import { deriveGas } from "./resolvers/gasResolver.js";
import type {
  Eip155CallParams,
  Eip155PreparedTransaction,
  Eip155PrepareResult,
  Eip155PrepareStepResult,
} from "./types.js";
import { pickDefined } from "./utils/helpers.js";
import { readErrorMessage } from "./utils/validation.js";

type PrepareTransactionDeps = {
  rpcClientFactory: (chainRef: string) => Eip155RpcClient;
  chains: ChainAddressCodecRegistry;
  feeOracleFactory?: (rpc: Eip155RpcClient) => Eip155FeeOracle;
};

const applyPrepareStep = <TPatch>(
  prepared: Eip155PreparedTransaction,
  step: Eip155PrepareStepResult<TPatch>,
  pickPrepared: (patch: TPatch) => Partial<Eip155PreparedTransaction>,
): Eip155PrepareResult | null => {
  Object.assign(prepared, pickPrepared(step.patch));
  if (step.status === "blocked") {
    return { status: "blocked", blocker: step.blocker, prepared };
  }
  if (step.status === "failed") {
    return { status: "failed", error: step.error, prepared };
  }
  return null;
};

export const createEip155PrepareTransaction = (deps: PrepareTransactionDeps) => {
  const chains = deps.chains;
  const deriveAddresses = createAddressResolver({ chains });
  const feeOracleFactory = deps.feeOracleFactory ?? ((rpc) => createEip155FeeOracle({ rpc }));

  return async (ctx: TransactionPrepareContext): Promise<Eip155PrepareResult> => {
    if (ctx.namespace !== "eip155") {
      throw arxError({
        reason: ArxReasons.RpcInvalidRequest,
        message: `Transaction preparer expects namespace "eip155" but received "${ctx.namespace}"`,
      });
    }

    const payload = ctx.request.payload as Eip155TransactionPayload;
    const prepared: Eip155PreparedTransaction = {};

    const addresses = deriveAddresses(ctx, {
      from: payload.from ?? null,
      to: "to" in payload ? (payload.to ?? null) : undefined,
    });
    const addressResult = applyPrepareStep(prepared, addresses, (patch) => patch);
    if (addressResult) return addressResult;

    const fields = deriveFields(ctx, payload);
    const fieldResult = applyPrepareStep(prepared, fields, (patch) => patch.prepared);
    if (fieldResult) return fieldResult;
    const fieldPatch = fields.patch;

    const payloadFeeInputs = pickDefined(fieldPatch.payloadValues, [
      "gasPrice",
      "maxFeePerGas",
      "maxPriorityFeePerGas",
    ] as const);

    let rpc: Eip155RpcClient | null = null;
    try {
      rpc = deps.rpcClientFactory(ctx.chainRef);
    } catch (error) {
      return {
        status: "failed",
        error: {
          reason: "transaction.prepare.rpc_unavailable",
          message: "Failed to create RPC client.",
          data: { error: readErrorMessage(error) },
        },
        prepared,
      };
    }

    const feeOracle = feeOracleFactory(rpc);

    const callParams: Eip155CallParams = {};
    if (prepared.from) callParams.from = prepared.from;
    if (prepared.to !== undefined && prepared.to !== null) callParams.to = prepared.to;
    if (prepared.value) callParams.value = prepared.value;
    if (prepared.data) callParams.data = prepared.data;

    const gasResolution = await deriveGas({
      rpc,
      callParams,
      gasProvided: fieldPatch.payloadValues.gas ?? null,
      nonceProvided: fieldPatch.payloadValues.nonce ?? null,
    });
    const gasResult = applyPrepareStep(prepared, gasResolution, (patch) => patch);
    if (gasResult) return gasResult;

    const feeResolution = await deriveFees({ feeOracle, payloadFees: payloadFeeInputs });
    const feeResult = applyPrepareStep(prepared, feeResolution, (patch) => patch);
    if (feeResult) return feeResult;

    const balanceResolution = await checkBalanceForMaxCost({ rpc, prepared });
    const balanceResult = applyPrepareStep(prepared, balanceResolution, (patch) => patch);
    if (balanceResult) return balanceResult;

    return { status: "ready", prepared };
  };
};

export type Eip155PrepareTransaction = ReturnType<typeof createEip155PrepareTransaction>;
