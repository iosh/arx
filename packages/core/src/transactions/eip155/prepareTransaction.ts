import type { Hex } from "ox/Hex";
import type { ChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import { createEip155AddressFormat } from "../../namespaces/eip155/address.js";
import type { ChainRef } from "../../networks/chainRef.js";
import * as HexQuantity from "../../utils/hex.js";
import { Eip155FeeModelUnsupportedError, Eip155PriorityFeeExceedsMaxFeeError } from "./errors.js";
import type * as Eip155 from "./types.js";

type PreparationInput = Readonly<{
  chainRef: ChainRef;
  from: string;
  transaction: Eip155.TransactionRequest;
}>;

type RpcTransaction = Readonly<{
  from: string;
  to?: string;
  value: Hex;
  data: Hex;
  gasPrice?: Hex;
  maxFeePerGas?: Hex;
  maxPriorityFeePerGas?: Hex;
}>;

type LatestBlock = Readonly<{
  baseFeePerGas?: Hex;
}>;

export type Eip155TransactionPreparer = (input: PreparationInput) => Promise<Eip155.PreparedTransaction>;

const rpcFeeFields = (fee: Eip155.Fee): Pick<RpcTransaction, "gasPrice" | "maxFeePerGas" | "maxPriorityFeePerGas"> =>
  fee.type === "legacy"
    ? { gasPrice: fee.gasPrice }
    : {
        maxFeePerGas: fee.maxFeePerGas,
        maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
      };

const createGasEstimateRequest = (input: {
  from: string;
  to: string | null;
  value: Hex;
  data: Hex;
  fee: Eip155.Fee;
}): RpcTransaction => ({
  from: input.from,
  ...(input.to === null ? {} : { to: input.to }),
  value: input.value,
  data: input.data,
  ...rpcFeeFields(input.fee),
});

export const createEip155TransactionPreparer = (params: { chainJsonRpc: ChainJsonRpc }): Eip155TransactionPreparer => {
  const addressFormat = createEip155AddressFormat();

  const getLatestBlockBaseFee = async (chainRef: ChainRef): Promise<Hex | undefined> => {
    const block = await params.chainJsonRpc.request<LatestBlock>({
      chainRef,
      method: "eth_getBlockByNumber",
      params: ["latest", false],
      replay: "allowed",
    });
    return block.baseFeePerGas;
  };

  const completeFee = async (chainRef: ChainRef, requestedFee: Eip155.FeeRequest | undefined): Promise<Eip155.Fee> => {
    if (requestedFee?.type === "legacy") {
      return {
        type: "legacy",
        gasPrice:
          requestedFee.gasPrice === undefined
            ? await params.chainJsonRpc.request<Hex>({
                chainRef,
                method: "eth_gasPrice",
                replay: "allowed",
              })
            : requestedFee.gasPrice,
      };
    }

    const baseFeePerGas = await getLatestBlockBaseFee(chainRef);
    if (requestedFee === undefined && baseFeePerGas === undefined) {
      return {
        type: "legacy",
        gasPrice: await params.chainJsonRpc.request<Hex>({
          chainRef,
          method: "eth_gasPrice",
          replay: "allowed",
        }),
      };
    }
    if (baseFeePerGas === undefined) throw new Eip155FeeModelUnsupportedError(chainRef);

    const maxPriorityFeePerGas =
      requestedFee?.maxPriorityFeePerGas === undefined
        ? await params.chainJsonRpc.request<Hex>({
            chainRef,
            method: "eth_maxPriorityFeePerGas",
            replay: "allowed",
          })
        : requestedFee.maxPriorityFeePerGas;
    const maxFeePerGas =
      requestedFee?.maxFeePerGas === undefined
        ? HexQuantity.fromNumber(HexQuantity.toBigInt(baseFeePerGas) * 2n + HexQuantity.toBigInt(maxPriorityFeePerGas))
        : requestedFee.maxFeePerGas;

    if (HexQuantity.toBigInt(maxPriorityFeePerGas) > HexQuantity.toBigInt(maxFeePerGas)) {
      throw new Eip155PriorityFeeExceedsMaxFeeError({ maxFeePerGas, maxPriorityFeePerGas });
    }

    return { type: "eip1559", maxFeePerGas, maxPriorityFeePerGas };
  };

  const estimateGas = async (chainRef: ChainRef, transaction: RpcTransaction): Promise<Hex> => {
    return params.chainJsonRpc.request<Hex>({
      chainRef,
      method: "eth_estimateGas",
      params: [transaction],
      replay: "allowed",
    });
  };

  return async (input) => {
    const to =
      input.transaction.to === undefined
        ? null
        : addressFormat.canonicalize({ chainRef: input.chainRef, value: input.transaction.to }).canonical;
    const value = input.transaction.value ?? ("0x0" as Hex);
    const data = input.transaction.data ?? ("0x" as Hex);
    const fee = await completeFee(input.chainRef, input.transaction.fee);
    const gas =
      input.transaction.gas === undefined
        ? await estimateGas(input.chainRef, createGasEstimateRequest({ from: input.from, to, value, data, fee }))
        : input.transaction.gas;
    const nonce = input.transaction.nonce;

    return {
      from: input.from,
      to,
      value,
      data,
      gas,
      ...(nonce === undefined ? {} : { nonce }),
      fee,
    };
  };
};
