import { ArxReasons, arxError } from "@arx/errors";
import { type ChainModuleRegistry, createDefaultChainModuleRegistry } from "../../../chains/registry.js";
import type { Eip155TransactionPayload } from "../../../controllers/transaction/types.js";
import type { Eip155RpcClient } from "../../../rpc/namespaceClients/eip155.js";
import type { TransactionAdapterContext } from "../types.js";
import { createEip155FeeOracle, type Eip155FeeOracle } from "./feeOracle.js";
import { createAddressResolver } from "./resolvers/addressResolver.js";
import { checkBalanceForMaxCost } from "./resolvers/balanceResolver.js";
import { deriveFees } from "./resolvers/feeResolver.js";
import { deriveFields } from "./resolvers/fieldResolver.js";
import { deriveGas } from "./resolvers/gasResolver.js";
import type { Eip155CallParams, Eip155PreparedTransaction, Eip155PreparedTransactionResult } from "./types.js";
import { pickDefined } from "./utils/helpers.js";
import { pushIssue, readErrorMessage } from "./utils/validation.js";

const hasFatalIssues = (issues: Eip155PreparedTransactionResult["issues"]): boolean => {
  // Fatal issues indicate the request is malformed or internally inconsistent.
  // Continuing with RPC-based enrichment would add noise and increase latency.
  const fatal = new Set([
    "transaction.prepare.invalid_hex",
    "transaction.prepare.invalid_data",
    "transaction.prepare.fee_conflict",
    "transaction.prepare.fee_pair_incomplete",
  ]);

  return issues.some((issue) => fatal.has(issue.code));
};

type PrepareTransactionDeps = {
  rpcClientFactory: (chainRef: string) => Eip155RpcClient;
  chains?: ChainModuleRegistry;
  feeOracleFactory?: (rpc: Eip155RpcClient) => Eip155FeeOracle;
};

export const createEip155PrepareTransaction = (deps: PrepareTransactionDeps) => {
  const chains = deps.chains ?? createDefaultChainModuleRegistry();
  const deriveAddresses = createAddressResolver({ chains });
  const feeOracleFactory = deps.feeOracleFactory ?? ((rpc) => createEip155FeeOracle({ rpc }));

  return async (ctx: TransactionAdapterContext): Promise<Eip155PreparedTransactionResult> => {
    if (ctx.namespace !== "eip155") {
      throw arxError({
        reason: ArxReasons.RpcInvalidRequest,
        message: `Transaction preparer expects namespace "eip155" but received "${ctx.namespace}"`,
      });
    }

    const payload = ctx.request.payload as Eip155TransactionPayload;
    const warnings: Eip155PreparedTransactionResult["warnings"] = [];
    const issues: Eip155PreparedTransactionResult["issues"] = [];
    const prepared: Eip155PreparedTransaction = {};

    const addresses = deriveAddresses(
      ctx,
      { from: payload.from ?? null, to: "to" in payload ? (payload.to ?? null) : undefined },
      issues,
    );
    Object.assign(prepared, addresses.prepared);

    const fields = deriveFields(ctx, payload, issues, warnings);
    Object.assign(prepared, fields.prepared);

    // Validate fee fields early so malformed requests short-circuit before any RPC work.
    const payloadFeeInputs = pickDefined(fields.payloadValues, [
      "gasPrice",
      "maxFeePerGas",
      "maxPriorityFeePerGas",
    ] as const);
    await deriveFees({ feeOracle: null, payloadFees: payloadFeeInputs, validateOnly: true }, issues);

    if (hasFatalIssues(issues)) {
      return { prepared, warnings, issues };
    }

    let rpc: Eip155RpcClient | null = null;
    try {
      rpc = deps.rpcClientFactory(ctx.chainRef);
    } catch (error) {
      pushIssue(
        issues,
        "transaction.prepare.rpc_unavailable",
        "Failed to create RPC client.",
        { error: readErrorMessage(error) },
        { severity: "high" },
      );
    }

    if (!rpc) {
      return { prepared, warnings, issues };
    }

    const feeOracle = feeOracleFactory(rpc);

    // Assemble callParams for gas estimation (exclude null values)
    const callParams: Eip155CallParams = {};
    if (prepared.from) callParams.from = prepared.from;
    if (prepared.to !== undefined && prepared.to !== null) callParams.to = prepared.to;
    if (prepared.value) callParams.value = prepared.value;
    if (prepared.data) callParams.data = prepared.data;

    const gasResolution = await deriveGas(
      {
        rpc,
        callParams,
        gasProvided: fields.payloadValues.gas ?? null,
        nonceProvided: fields.payloadValues.nonce ?? null,
      },
      issues,
      warnings,
    );
    Object.assign(prepared, gasResolution.prepared);

    const feeResolution = await deriveFees({ feeOracle, payloadFees: payloadFeeInputs }, issues);
    Object.assign(prepared, feeResolution.prepared);

    await checkBalanceForMaxCost({ rpc, prepared, issues, warnings });

    return { prepared, warnings, issues };
  };
};

export type Eip155PrepareTransaction = ReturnType<typeof createEip155PrepareTransaction>;
