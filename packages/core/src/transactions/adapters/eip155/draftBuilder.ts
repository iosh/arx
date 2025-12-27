import { ArxReasons, arxError } from "@arx/errors";
import { type ChainModuleRegistry, createDefaultChainModuleRegistry } from "../../../chains/registry.js";
import type { Eip155TransactionPayload } from "../../../controllers/transaction/types.js";
import type { Eip155RpcCapabilities } from "../../../rpc/clients/eip155/eip155.js";
import type { TransactionAdapterContext } from "../types.js";
import { createAddressResolver } from "./resolvers/addressResolver.js";
import { resolveFees } from "./resolvers/feeResolver.js";
import { resolveFields } from "./resolvers/fieldResolver.js";
import { resolveGas } from "./resolvers/gasResolver.js";
import type { Eip155DraftPrepared, Eip155DraftSummary, Eip155TransactionDraft } from "./types.js";
import { pickDefined } from "./utils/helpers.js";
import { pushIssue, readErrorMessage } from "./utils/validation.js";

type DraftBuilderDeps = {
  rpcClientFactory: (chainRef: string) => Eip155RpcCapabilities;
  chains?: ChainModuleRegistry;
  now?: () => number;
};

export const createEip155DraftBuilder = (deps: DraftBuilderDeps) => {
  const chains = deps.chains ?? createDefaultChainModuleRegistry();
  const readNow = deps.now ?? Date.now;
  const resolveAddresses = createAddressResolver({ chains });

  return async (ctx: TransactionAdapterContext): Promise<Eip155TransactionDraft> => {
    if (ctx.namespace !== "eip155") {
      throw arxError({
        reason: ArxReasons.RpcInvalidRequest,
        message: `Draft builder expects namespace "eip155" but received "${ctx.namespace}"`,
      });
    }

    const payload = ctx.request.payload as Eip155TransactionPayload;
    const warnings: Eip155TransactionDraft["warnings"] = [];
    const issues: Eip155TransactionDraft["issues"] = [];
    const prepared = { callParams: {} } as Eip155DraftPrepared;
    const summary: Eip155DraftSummary = {
      generatedAt: readNow(),
      namespace: ctx.namespace,
      chainRef: ctx.chainRef,
      rpcAvailable: false,
      feeMode: "unknown",
      callParams: {},
    };

    const addresses = resolveAddresses(
      ctx,
      { from: payload.from ?? null, to: "to" in payload ? (payload.to ?? null) : undefined },
      issues,
    );
    Object.assign(prepared, addresses.prepared);
    Object.assign(summary, addresses.summary);

    const fields = resolveFields(ctx, payload, issues, warnings);
    Object.assign(prepared, fields.prepared);
    Object.assign(summary, fields.summary);

    let rpc: Eip155RpcCapabilities | null = null;
    try {
      rpc = deps.rpcClientFactory(ctx.chainRef);
    } catch (error) {
      pushIssue(issues, "transaction.draft.rpc_unavailable", "Failed to create RPC client.", {
        error: readErrorMessage(error),
      });
    }

    summary.rpcAvailable = rpc !== null;

    // Assemble callParams for gas estimation (exclude null values)
    const callParams: Eip155DraftPrepared["callParams"] = {};
    if (prepared.from) callParams.from = prepared.from;
    if (prepared.to) callParams.to = prepared.to;
    if (prepared.value) callParams.value = prepared.value;
    if (prepared.data) callParams.data = prepared.data;
    prepared.callParams = callParams;
    summary.callParams = callParams;

    const gasPreparedInputs = pickDefined(prepared, [
      "gasPrice",
      "maxFeePerGas",
      "maxPriorityFeePerGas",
      "nonce",
    ] as const);

    const gasResolution = await resolveGas(
      {
        rpc,
        callParams: prepared.callParams,
        prepared: gasPreparedInputs,
        gasProvided: fields.payloadValues.gas ?? null,
        nonceProvided: fields.payloadValues.nonce ?? null,
      },
      issues,
      warnings,
    );
    Object.assign(prepared, gasResolution.prepared);
    Object.assign(summary, gasResolution.summary);

    // Assemble fee parameters
    const feeValueInputs = pickDefined(prepared, ["gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"] as const);
    const payloadFeeInputs = pickDefined(fields.payloadValues, [
      "gasPrice",
      "maxFeePerGas",
      "maxPriorityFeePerGas",
    ] as const);

    const feeParams: Parameters<typeof resolveFees>[0] = {
      rpc,
      feeValues: feeValueInputs,
      payloadFees: payloadFeeInputs,
    };
    if (prepared.gas) feeParams.gas = prepared.gas;
    if (prepared.value) feeParams.value = prepared.value;

    const feeResolution = await resolveFees(feeParams, issues);
    Object.assign(prepared, feeResolution.prepared);
    Object.assign(summary, feeResolution.summary);

    return { prepared, summary, warnings, issues };
  };
};

export type Eip155DraftBuilder = ReturnType<typeof createEip155DraftBuilder>;
