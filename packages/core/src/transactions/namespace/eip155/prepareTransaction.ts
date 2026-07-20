import type { ChainJsonRpc } from "../../../chainJsonRpc/ChainJsonRpc.js";
import type { ChainAddressingByNamespace } from "../../../chains/addressing.js";
import { createEip155FeeOracle, type Eip155FeeOracle } from "./feeOracle.js";
import { createAddressResolver } from "./resolvers/addressResolver.js";
import { checkBalanceForMaxCost } from "./resolvers/balanceResolver.js";
import { deriveFees } from "./resolvers/feeResolver.js";
import { deriveFields } from "./resolvers/fieldResolver.js";
import { deriveGas } from "./resolvers/gasResolver.js";
import type { Eip155CallParams, Eip155PrepareContext, Eip155PrepareResult, Eip155PrepareStepResult } from "./types.js";
import type {
  Eip155PreparedTransaction,
  Eip155TransactionCoreFields,
  Eip155UnsignedTransactionDraft,
} from "./unsignedTransaction.js";

type PrepareTransactionDeps = {
  chainJsonRpc: ChainJsonRpc;
  chains: ChainAddressingByNamespace;
  feeOracleFactory?: (chainJsonRpc: ChainJsonRpc, chainRef: string) => Eip155FeeOracle;
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

type Eip155PreparedCoreFields = Omit<Eip155TransactionCoreFields, "nonce"> & {
  nonce?: Eip155TransactionCoreFields["nonce"];
};

type Eip155PreparedLegacyDraft = Eip155PreparedCoreFields & {
  gasPrice: NonNullable<Eip155UnsignedTransactionDraft["gasPrice"]>;
};

type Eip155PreparedEip1559Draft = Eip155PreparedCoreFields & {
  maxFeePerGas: NonNullable<Eip155UnsignedTransactionDraft["maxFeePerGas"]>;
  maxPriorityFeePerGas: NonNullable<Eip155UnsignedTransactionDraft["maxPriorityFeePerGas"]>;
};

/** Turns the mutable review snapshot into a submit-ready proposal payload. */
const buildPreparedTransaction = (
  transaction: Eip155PreparedLegacyDraft | Eip155PreparedEip1559Draft,
): Eip155PreparedTransaction => {
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

const readPreparedCoreFields = (transaction: Eip155UnsignedTransactionDraft): Eip155PreparedCoreFields => {
  const resolved = transaction as Eip155PreparedCoreFields;
  return {
    chainId: resolved.chainId,
    from: resolved.from,
    to: resolved.to ?? null,
    value: resolved.value,
    data: resolved.data,
    gas: resolved.gas,
    ...(resolved.nonce !== undefined ? { nonce: resolved.nonce } : {}),
  };
};

export const createEip155PrepareTransaction = (deps: PrepareTransactionDeps) => {
  const chains = deps.chains;
  const deriveAddresses = createAddressResolver({ chains });
  const feeOracleFactory =
    deps.feeOracleFactory ?? ((chainJsonRpc, chainRef) => createEip155FeeOracle({ chainJsonRpc, chainRef }));

  return async (ctx: Eip155PrepareContext): Promise<Eip155PrepareResult> => {
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

    const feeOracle = feeOracleFactory(deps.chainJsonRpc, ctx.chainRef);

    const callParams: Eip155CallParams = {};
    if (prepared.from) callParams.from = prepared.from;
    if (prepared.to !== undefined && prepared.to !== null) callParams.to = prepared.to;
    if (prepared.value) callParams.value = prepared.value;
    if (prepared.data) callParams.data = prepared.data;

    const gasResolution = await deriveGas({
      chainJsonRpc: deps.chainJsonRpc,
      chainRef: ctx.chainRef,
      callParams,
      gasProvided: fieldPatch.payloadValues.gas ?? null,
    });
    const gasResult = applyPrepareStep(prepared, gasResolution, (patch) => patch);
    if (gasResult) return gasResult;

    const feeResolution = await deriveFees({ feeOracle, payloadFees: payloadFeeInputs });
    const feeResult = applyPrepareStep(prepared, feeResolution, (patch) => patch);
    if (feeResult) return feeResult;

    const balanceResolution = await checkBalanceForMaxCost({
      chainJsonRpc: deps.chainJsonRpc,
      chainRef: ctx.chainRef,
      prepared,
    });
    const balanceResult = applyPrepareStep(prepared, balanceResolution, (patch) => patch);
    if (balanceResult) return balanceResult;

    const coreFields = readPreparedCoreFields(prepared);

    const gasPrice = prepared.gasPrice;
    if (gasPrice) {
      return {
        status: "ready",
        prepared: buildPreparedTransaction({
          ...coreFields,
          gasPrice,
        }),
        reviewSnapshot: prepared,
      };
    }

    const maxFeePerGas = prepared.maxFeePerGas;
    const maxPriorityFeePerGas = prepared.maxPriorityFeePerGas;
    return {
      status: "ready",
      prepared: buildPreparedTransaction({
        ...coreFields,
        maxFeePerGas: maxFeePerGas as Eip155PreparedEip1559Draft["maxFeePerGas"],
        maxPriorityFeePerGas: maxPriorityFeePerGas as Eip155PreparedEip1559Draft["maxPriorityFeePerGas"],
      }),
      reviewSnapshot: prepared,
    };
  };
};

export type Eip155PrepareTransaction = ReturnType<typeof createEip155PrepareTransaction>;
