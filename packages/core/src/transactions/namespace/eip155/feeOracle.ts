import type { Hex as OxHex } from "ox/Hex";
import * as Hex from "ox/Hex";
import type { ChainJsonRpcClient } from "../../../chainJsonRpc/ChainJsonRpc.js";
import type { ChainRef } from "../../../networks/chainRef.js";
import { Eip155FeeOracleResponseError } from "./errors.js";

export type Eip155FeeSuggestion =
  | { mode: "legacy"; gasPrice: OxHex; source: "eth_gasPrice" }
  | {
      mode: "eip1559";
      maxFeePerGas: OxHex;
      maxPriorityFeePerGas: OxHex;
      baseFeePerGas?: OxHex;
      source: "eth_feeHistory+eth_getBlockByNumber" | "eth_maxPriorityFeePerGas+eth_getBlockByNumber";
    };

export type Eip155FeeOracle = {
  suggestFees(overrides?: { timeoutMs?: number }): Promise<Eip155FeeSuggestion>;
};

type FeeOracleDeps = {
  chainJsonRpc: ChainJsonRpcClient;
  chainRef: ChainRef;
};

const FEE_HISTORY_BLOCK_COUNT: OxHex = "0x5";
const FEE_HISTORY_REWARD_PERCENTILES = [20] as const;
const MIN_TIP_WEI = 1_000_000_000n; // 1 gwei

const toBigIntQuantity = (value: unknown): bigint | null => {
  try {
    if (typeof value !== "string") return null;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed.startsWith("0x")) return null;
    return BigInt(trimmed);
  } catch {
    return null;
  }
};

const medianBigInt = (values: bigint[]): bigint | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
};

export const createEip155FeeOracle = (deps: FeeOracleDeps): Eip155FeeOracle => {
  return {
    async suggestFees(overrides) {
      const timeoutMs = overrides?.timeoutMs;
      const rpcOverrides = timeoutMs !== undefined ? { timeoutMs } : undefined;
      try {
        // - Use `latest` base fee (more consistent than `pending` across providers/caches).
        // - Prefer `eth_feeHistory` for priority fee sampling; fall back to `eth_maxPriorityFeePerGas`.
        const baseFeeBlock = await deps.chainJsonRpc.request<Record<string, unknown>>({
          chainRef: deps.chainRef,
          method: "eth_getBlockByNumber",
          params: ["latest", false],
          ...rpcOverrides,
        });
        const baseFee = toBigIntQuantity(baseFeeBlock.baseFeePerGas);
        if (baseFee !== null) {
          const feeHistory = await deps.chainJsonRpc
            .request<{ reward?: unknown[][] }>({
              chainRef: deps.chainRef,
              method: "eth_feeHistory",
              params: [FEE_HISTORY_BLOCK_COUNT, "latest", [...FEE_HISTORY_REWARD_PERCENTILES]],
              ...rpcOverrides,
            })
            .catch(() => null);

          const rewardSamples =
            feeHistory?.reward
              ?.map((rewards) => toBigIntQuantity(rewards?.[0]))
              .filter((v): v is bigint => v !== null) ?? [];

          const sampledTip = medianBigInt(rewardSamples);
          const fallbackTip =
            sampledTip !== null
              ? null
              : toBigIntQuantity(
                  await deps.chainJsonRpc
                    .request<string>({ chainRef: deps.chainRef, method: "eth_maxPriorityFeePerGas", ...rpcOverrides })
                    .catch(() => null),
                );

          // `eth_feeHistory` may return 0 rewards for empty blocks; avoid producing 0-tip suggestions.
          const tipCandidate = sampledTip ?? fallbackTip;
          const tip = tipCandidate !== null ? (tipCandidate < MIN_TIP_WEI ? MIN_TIP_WEI : tipCandidate) : null;

          if (tip !== null) {
            const maxFee = baseFee * 2n + tip;

            const source = feeHistory
              ? "eth_feeHistory+eth_getBlockByNumber"
              : "eth_maxPriorityFeePerGas+eth_getBlockByNumber";

            return {
              mode: "eip1559",
              maxFeePerGas: Hex.fromNumber(maxFee),
              maxPriorityFeePerGas: Hex.fromNumber(tip),
              baseFeePerGas: Hex.fromNumber(baseFee),
              source,
            };
          }
        }
      } catch {
        // ignore and fall back
      }

      const gasPriceHex = await deps.chainJsonRpc.request<string>({
        chainRef: deps.chainRef,
        method: "eth_gasPrice",
        ...rpcOverrides,
      });
      const gasPrice = toBigIntQuantity(gasPriceHex);
      if (gasPrice === null || gasPrice < 0n) {
        throw new Eip155FeeOracleResponseError({ method: "eth_gasPrice", value: gasPriceHex });
      }
      return { mode: "legacy", gasPrice: Hex.fromNumber(gasPrice), source: "eth_gasPrice" };
    },
  };
};
