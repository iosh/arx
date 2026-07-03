import type { ChainAddressingByNamespace } from "../../../chains/addressing.js";
import type { Eip155RpcClient } from "../../../rpc/namespaceClients/eip155.js";
import { createEip155FeeOracle, type Eip155FeeOracle } from "./feeOracle.js";
import { createAddressResolver } from "./resolvers/addressResolver.js";
import { checkBalanceForMaxCost } from "./resolvers/balanceResolver.js";
import { deriveFees } from "./resolvers/feeResolver.js";
import { deriveFields } from "./resolvers/fieldResolver.js";
import { deriveGas } from "./resolvers/gasResolver.js";
import type { Eip155CallParams, Eip155PrepareContext, Eip155PrepareResult, Eip155PrepareStepResult } from "./types.js";
import type {
  Eip155TransactionCoreFields,
  Eip155UnsignedTransaction,
  Eip155UnsignedTransactionDraft,
} from "./unsignedTransaction.js";
import { readErrorMessage } from "./utils/validation.js";

type PrepareTransactionDeps = {
  rpcClientFactory: (chainRef: string) => Eip155RpcClient;
  chains: ChainAddressingByNamespace;
  feeOracleFactory?: (rpc: Eip155RpcClient) => Eip155FeeOracle;
};

const applyPrepareStep = <TPatch>(
  prepared: Eip155UnsignedTransactionDraft,
  step: Eip155PrepareStepResult<TPatch>,
  pickPrepared: (patch: TPatch) => Partial<Eip155UnsignedTransactionDraft>,
): Eip155PrepareResult | null => {
  Object.assign(prepared, pickPrepared(step.patch));
  if (step.status === "blocked") {
    return { status: "blocked", blocker: step.blocker, reviewSnapshot: prepared };
  }
  if (step.status === "failed") {
    return { status: "failed", error: step.error, reviewSnapshot: prepared };
  }
  return null;
};

type Eip155PreparedLegacyDraft = Eip155TransactionCoreFields & {
  gasPrice: NonNullable<Eip155UnsignedTransactionDraft["gasPrice"]>;
};

type Eip155PreparedEip1559Draft = Eip155TransactionCoreFields & {
  maxFeePerGas: NonNullable<Eip155UnsignedTransactionDraft["maxFeePerGas"]>;
  maxPriorityFeePerGas: NonNullable<Eip155UnsignedTransactionDraft["maxPriorityFeePerGas"]>;
};

/** Turns the mutable review snapshot into the final signable payload. */
const buildPreparedTransaction = (
  transaction: Eip155PreparedLegacyDraft | Eip155PreparedEip1559Draft,
): Eip155UnsignedTransaction => {
  if ("gasPrice" in transaction) {
    return {
      ...transaction,
      type: "legacy",
    };
  }

  return {
    ...transaction,
    type: "eip1559",
  };
};

const buildPreparedCoreFields = (transaction: Eip155UnsignedTransactionDraft): Eip155TransactionCoreFields => ({
  chainId: transaction.chainId as Eip155TransactionCoreFields["chainId"],
  from: transaction.from as Eip155TransactionCoreFields["from"],
  to: transaction.to ?? null,
  value: transaction.value as Eip155TransactionCoreFields["value"],
  data: transaction.data as Eip155TransactionCoreFields["data"],
  gas: transaction.gas as Eip155TransactionCoreFields["gas"],
  nonce: transaction.nonce as Eip155TransactionCoreFields["nonce"],
});

export const createEip155PrepareTransaction = (deps: PrepareTransactionDeps) => {
  const chains = deps.chains;
  const deriveAddresses = createAddressResolver({ chains });
  const feeOracleFactory = deps.feeOracleFactory ?? ((rpc) => createEip155FeeOracle({ rpc }));

  return async (ctx: Eip155PrepareContext): Promise<Eip155PrepareResult> => {
    if (ctx.namespace !== "eip155") {
      throw new Error(`Transaction preparer expects namespace "eip155" but received "${ctx.namespace}"`);
    }

    const payload = ctx.request.payload;
    const prepared: Eip155UnsignedTransactionDraft = {};

    const addresses = deriveAddresses(ctx, {
      from: payload.from ?? null,
      to: "to" in payload ? (payload.to ?? null) : null,
    });
    const addressResult = applyPrepareStep(prepared, addresses, (patch) => patch);
    if (addressResult) return addressResult;

    const fields = deriveFields(ctx, payload);
    const fieldResult = applyPrepareStep(prepared, fields, (patch) => patch.prepared);
    if (fieldResult) return fieldResult;
    const fieldPatch = fields.patch;

    const payloadFeeInputs = {
      ...(fieldPatch.payloadValues.gasPrice !== undefined ? { gasPrice: fieldPatch.payloadValues.gasPrice } : {}),
      ...(fieldPatch.payloadValues.maxFeePerGas !== undefined
        ? { maxFeePerGas: fieldPatch.payloadValues.maxFeePerGas }
        : {}),
      ...(fieldPatch.payloadValues.maxPriorityFeePerGas !== undefined
        ? { maxPriorityFeePerGas: fieldPatch.payloadValues.maxPriorityFeePerGas }
        : {}),
    };

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
        reviewSnapshot: prepared,
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

    const coreFields = buildPreparedCoreFields(prepared);

    if (prepared.gasPrice) {
      return {
        status: "ready",
        prepared: buildPreparedTransaction({
          ...coreFields,
          gasPrice: prepared.gasPrice,
        }),
        reviewSnapshot: prepared,
      };
    }

    return {
      status: "ready",
      prepared: buildPreparedTransaction({
        ...coreFields,
        maxFeePerGas: prepared.maxFeePerGas as NonNullable<Eip155UnsignedTransactionDraft["maxFeePerGas"]>,
        maxPriorityFeePerGas: prepared.maxPriorityFeePerGas as NonNullable<
          Eip155UnsignedTransactionDraft["maxPriorityFeePerGas"]
        >,
      }),
      reviewSnapshot: prepared,
    };
  };
};

export type Eip155PrepareTransaction = ReturnType<typeof createEip155PrepareTransaction>;
