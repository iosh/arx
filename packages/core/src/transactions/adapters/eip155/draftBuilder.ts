import { parseCaip2 } from "../../../chains/caip.js";
import { createDefaultChainModuleRegistry } from "../../../chains/registry.js";
import type { Eip155TransactionPayload } from "../../../controllers/transaction/types.js";
import { getRpcErrors } from "../../../errors/index.js";
import type { Eip155RpcCapabilities } from "../../../rpc/clients/eip155/eip155.js";
import type { TransactionAdapterContext, TransactionDraft } from "../types.js";

const HEX_QUANTITY_PATTERN = /^0x[0-9a-fA-F]+$/;
const HEX_DATA_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/;

const deriveExpectedChainId = (chainRef: string): string | null => {
  try {
    const { reference } = parseCaip2(chainRef);
    if (/^\d+$/.test(reference)) {
      return `0x${BigInt(reference).toString(16)}`;
    }
  } catch {
    // ignore — upstream already validates caip2
  }
  return null;
};

const normaliseHexQuantity = (
  issues: TransactionDraft["issues"],
  value: string | undefined,
  label: string,
): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!HEX_QUANTITY_PATTERN.test(trimmed)) {
    pushIssue(issues, "transaction.draft.invalid_hex", `${label} must be a 0x-prefixed hex quantity.`, { value });
    return null;
  }
  return trimmed.toLowerCase();
};

const normaliseHexData = (issues: TransactionDraft["issues"], value: string | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!HEX_DATA_PATTERN.test(trimmed)) {
    pushIssue(issues, "transaction.draft.invalid_data", "data must be 0x-prefixed even-length hex.", { value });
    return null;
  }
  return trimmed.toLowerCase();
};

type DraftBuilderDeps = {
  rpcClientFactory: (chainRef: string) => Eip155RpcCapabilities;
  now?: () => number;
};

const readErrorMessage = (value: unknown): string => {
  if (value instanceof Error && typeof value.message === "string") {
    return value.message;
  }
  return String(value);
};

const pushIssue = (
  issues: TransactionDraft["issues"],
  code: string,
  message: string,
  data?: Record<string, unknown>,
) => {
  const entry: TransactionDraft["issues"][number] = { code, message };
  if (data !== undefined) {
    entry.data = data;
  }
  issues.push(entry);
};

const pushWarning = (
  warnings: TransactionDraft["warnings"],
  code: string,
  message: string,
  data?: Record<string, unknown>,
) => {
  const entry: TransactionDraft["warnings"][number] = { code, message };
  if (data !== undefined) {
    entry.data = data;
  }
  warnings.push(entry);
};

const toChecksum = (
  chains: ReturnType<typeof createDefaultChainModuleRegistry>,
  chainRef: string,
  canonical: string,
) => {
  return chains.formatAddress({ chainRef, canonical });
};

export const createEip155DraftBuilder = (deps: DraftBuilderDeps) => {
  const chains = createDefaultChainModuleRegistry();
  const rpcErrors = getRpcErrors("eip155");
  const readNow = deps.now ?? Date.now;

  return async (ctx: TransactionAdapterContext): Promise<TransactionDraft> => {
    if (ctx.namespace !== "eip155") {
      throw rpcErrors.invalidRequest({
        message: `Draft builder expects namespace "eip155" but received "${ctx.namespace}"`,
      });
    }

    const payload = ctx.request.payload as Eip155TransactionPayload;
    const warnings: TransactionDraft["warnings"] = [];
    const issues: TransactionDraft["issues"] = [];
    const prepared: Record<string, unknown> = {};
    const summary: Record<string, unknown> = {
      generatedAt: readNow(),
      namespace: ctx.namespace,
      chainRef: ctx.chainRef,
    };

    let rpc: Eip155RpcCapabilities | null = null;
    try {
      rpc = deps.rpcClientFactory(ctx.chainRef);
    } catch (error) {
      pushIssue(issues, "transaction.draft.rpc_unavailable", "Failed to create RPC client.", {
        error: readErrorMessage(error),
      });
    }

    summary.rpcAvailable = rpc !== null;
    const requestFrom = payload.from ?? null;
    const contextFrom = ctx.from ?? null;
    const resolvedFrom = requestFrom ?? contextFrom;

    if (!resolvedFrom) {
      pushIssue(issues, "transaction.draft.from_missing", "Transaction requires a from address.");
    } else {
      try {
        const normalized = chains.normalizeAddress({ chainRef: ctx.chainRef, value: resolvedFrom });
        prepared.from = normalized.canonical;
        summary.from = toChecksum(chains, ctx.chainRef, normalized.canonical);
        if (requestFrom && contextFrom) {
          const requestCanonical = chains.normalizeAddress({ chainRef: ctx.chainRef, value: requestFrom }).canonical;
          const contextCanonical = chains.normalizeAddress({ chainRef: ctx.chainRef, value: contextFrom }).canonical;
          if (requestCanonical !== contextCanonical) {
            pushIssue(issues, "transaction.draft.from_mismatch", "Payload from does not match active account.", {
              payloadFrom: requestFrom,
              activeFrom: contextFrom,
            });
          }
        }
      } catch (error) {
        pushIssue(issues, "transaction.draft.from_invalid", "Invalid from address.", {
          address: resolvedFrom,
          error: readErrorMessage(error),
        });
      }
    }

    if ("to" in payload) {
      if (payload.to === null) {
        prepared.to = null;
        summary.to = null;
      } else if (payload.to !== undefined) {
        try {
          const normalized = chains.normalizeAddress({ chainRef: ctx.chainRef, value: payload.to });
          prepared.to = normalized.canonical;
          summary.to = toChecksum(chains, ctx.chainRef, normalized.canonical);
        } catch (error) {
          pushIssue(issues, "transaction.draft.to_invalid", "Invalid to address.", {
            address: payload.to,
            error: readErrorMessage(error),
          });
        }
      }
    }

    const expectedChainId = deriveExpectedChainId(ctx.chainRef);
    if (expectedChainId) {
      summary.expectedChainId = expectedChainId;
    }

    if (payload.chainId) {
      const chainId = payload.chainId.trim().toLowerCase();
      prepared.chainId = chainId;
      summary.chainId = chainId;
      if (expectedChainId && chainId !== expectedChainId) {
        pushIssue(issues, "transaction.draft.chain_id_mismatch", "chainId does not match active chain.", {
          payloadChainId: chainId,
          expectedChainId,
        });
      }
    } else {
      pushWarning(warnings, "transaction.draft.chain_id_missing", "Transaction payload is missing chainId.");
    }

    const valueHex = normaliseHexQuantity(issues, payload.value, "value");
    if (valueHex) {
      prepared.value = valueHex;
      summary.valueHex = valueHex;
      try {
        summary.valueWei = BigInt(valueHex).toString(10);
      } catch {
        // already validated by regex; ignore conversion edge cases
      }
    }

    const dataHex = normaliseHexData(issues, payload.data);
    if (dataHex) {
      prepared.data = dataHex;
      summary.data = dataHex;
    }

    const gasHex = normaliseHexQuantity(issues, payload.gas, "gas");
    if (gasHex) {
      prepared.gas = gasHex;
      summary.gas = gasHex;
    }

    const gasPriceHex = normaliseHexQuantity(issues, payload.gasPrice, "gasPrice");
    if (gasPriceHex) {
      prepared.gasPrice = gasPriceHex;
    }

    const maxFeeHex = normaliseHexQuantity(issues, payload.maxFeePerGas, "maxFeePerGas");
    if (maxFeeHex) {
      prepared.maxFeePerGas = maxFeeHex;
    }

    const priorityFeeHex = normaliseHexQuantity(issues, payload.maxPriorityFeePerGas, "maxPriorityFeePerGas");
    if (priorityFeeHex) {
      prepared.maxPriorityFeePerGas = priorityFeeHex;
    }

    const nonceHex = normaliseHexQuantity(issues, payload.nonce, "nonce");
    if (nonceHex) {
      prepared.nonce = nonceHex;
      summary.nonce = nonceHex;
    }

    const callParams: Record<string, string> = {};
    if (typeof prepared.from === "string") callParams.from = prepared.from;
    if (typeof prepared.to === "string") callParams.to = prepared.to;
    if (typeof prepared.value === "string") callParams.value = prepared.value;
    if (typeof prepared.data === "string") callParams.data = prepared.data;

    prepared.callParams = callParams;
    summary.callParams = callParams;

    if (!nonceHex && rpc && callParams.from) {
      try {
        const fetchedNonce = await rpc.getTransactionCount(callParams.from, "pending");
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

    if (!gasHex && rpc) {
      try {
        const estimateArgs: Record<string, string> = { ...callParams };
        if (typeof prepared.gasPrice === "string") estimateArgs.gasPrice = prepared.gasPrice;
        if (typeof prepared.maxFeePerGas === "string") estimateArgs.maxFeePerGas = prepared.maxFeePerGas;
        if (typeof prepared.maxPriorityFeePerGas === "string") {
          estimateArgs.maxPriorityFeePerGas = prepared.maxPriorityFeePerGas;
        }
        if (typeof prepared.nonce === "string") estimateArgs.nonce = prepared.nonce;

        summary.estimateInput = estimateArgs;
        const estimatedGas = await rpc.estimateGas([estimateArgs]);
        const normalisedGas = normaliseHexQuantity(issues, estimatedGas, "gas");
        if (normalisedGas) {
          const gasValue = BigInt(normalisedGas);
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

    if (gasPriceHex && (maxFeeHex || priorityFeeHex)) {
      pushIssue(issues, "transaction.draft.fee_conflict", "Cannot mix legacy gasPrice with EIP-1559 fields.", {
        gasPrice: gasPriceHex,
        maxFeePerGas: maxFeeHex,
        maxPriorityFeePerGas: priorityFeeHex,
      });
    }

    if ((maxFeeHex && !priorityFeeHex) || (!maxFeeHex && priorityFeeHex)) {
      pushIssue(
        issues,
        "transaction.draft.fee_pair_incomplete",
        "EIP-1559 requires both maxFeePerGas and maxPriorityFeePerGas.",
        {
          maxFeePerGas: maxFeeHex,
          maxPriorityFeePerGas: priorityFeeHex,
        },
      );
    }

    let feeMode: "legacy" | "eip1559" | "unknown" = "unknown";

    if (gasPriceHex && !maxFeeHex && !priorityFeeHex) {
      feeMode = "legacy";
      summary.fee = { mode: feeMode, gasPrice: gasPriceHex };
    } else if (maxFeeHex && priorityFeeHex && !gasPriceHex) {
      feeMode = "eip1559";
      summary.fee = { mode: feeMode, maxFeePerGas: maxFeeHex, maxPriorityFeePerGas: priorityFeeHex };
    } else if (!gasPriceHex && !maxFeeHex && !priorityFeeHex && rpc) {
      try {
        const feeData = await rpc.getFeeData();
        if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
          const fetchedMaxFee = normaliseHexQuantity(issues, feeData.maxFeePerGas, "maxFeePerGas");
          const fetchedPriorityFee = normaliseHexQuantity(issues, feeData.maxPriorityFeePerGas, "maxPriorityFeePerGas");
          if (fetchedMaxFee && fetchedPriorityFee) {
            feeMode = "eip1559";
            prepared.maxFeePerGas = fetchedMaxFee;
            prepared.maxPriorityFeePerGas = fetchedPriorityFee;
            summary.fee = { mode: feeMode, maxFeePerGas: fetchedMaxFee, maxPriorityFeePerGas: fetchedPriorityFee };
          }
        } else if (feeData.gasPrice) {
          const fetchedGasPrice = normaliseHexQuantity(issues, feeData.gasPrice, "gasPrice");
          if (fetchedGasPrice) {
            feeMode = "legacy";
            prepared.gasPrice = fetchedGasPrice;
            summary.fee = { mode: feeMode, gasPrice: fetchedGasPrice };
          }
        } else {
          pushIssue(issues, "transaction.draft.fee_estimation_empty", "RPC fee data response is empty.", {
            method: "eth_getBlockByNumber | eth_gasPrice",
          });
        }
      } catch (error) {
        pushIssue(issues, "transaction.draft.fee_estimation_failed", "Failed to fetch fee data.", {
          method: "eth_feeHistory | eth_gasPrice",
          error: readErrorMessage(error),
        });
      }
    }

    const computeMaxCostWei = (): string | null => {
      try {
        const gas = typeof prepared.gas === "string" ? BigInt(prepared.gas) : null;

        let gasCost = BigInt(0);

        if (gas) {
          if (feeMode === "legacy" && typeof prepared.gasPrice === "string") {
            gasCost = gas * BigInt(prepared.gasPrice);
          } else if (feeMode === "eip1559" && typeof prepared.maxFeePerGas === "string") {
            gasCost = gas * BigInt(prepared.maxFeePerGas);
          }
        }
        const value = typeof prepared.value === "string" ? BigInt(prepared.value) : BigInt(0);
        const total = gasCost + value;
        return total === BigInt(0) ? null : total.toString(10);
      } catch {
        return null;
      }
    };

    const maxCostWei = computeMaxCostWei();
    if (maxCostWei) {
      summary.maxCostWei = maxCostWei;
      summary.maxCostHex = `0x${BigInt(maxCostWei).toString(16)}`;
    }

    summary.feeMode = feeMode;

    return { prepared, summary, warnings, issues };
  };
};

export type Eip155DraftBuilder = ReturnType<typeof createEip155DraftBuilder>;
