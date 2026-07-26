import type { AccessList } from "ox/AccessList";
import type { Hex } from "ox/Hex";
import type { ChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import { createEip155AddressFormat } from "../../namespaces/eip155/address.js";
import type { ChainRef } from "../../networks/chainRef.js";
import * as HexNumber from "../../utils/hex.js";
import { Eip155FeeModelUnsupportedError, Eip155PriorityFeeExceedsMaxFeeError } from "./errors.js";
import { createEip155TransactionEnvelope } from "./transactionEnvelope.js";
import type * as Eip155 from "./types.js";

type PreparationInput = Readonly<{
  chainRef: ChainRef;
  from: string;
  transaction: Eip155.TransactionRequest;
}>;

type PreparedWithoutGas =
  | Omit<Eip155.LegacyPreparedTransaction, "gas" | "nonce">
  | Omit<Eip155.Eip2930PreparedTransaction, "gas" | "nonce">
  | Omit<Eip155.Eip1559PreparedTransaction, "gas" | "nonce">;

type GasEstimateRequest = Readonly<{
  from: string;
  to?: string;
  value: Hex;
  data: Hex;
  type?: "0x1" | "0x2";
  gasPrice?: Hex;
  maxFeePerGas?: Hex;
  maxPriorityFeePerGas?: Hex;
  accessList?: Array<{ address: string; storageKeys: Hex[] }>;
}>;

type LatestBlock = Readonly<{
  baseFeePerGas?: Hex;
}>;

type Eip1559Fees = Readonly<{
  maxFeePerGas: Hex;
  maxPriorityFeePerGas: Hex;
}>;

export type Eip155TransactionPreparer = (input: PreparationInput) => Promise<Eip155.PreparedTransaction>;

const rpcAccessList = (accessList: AccessList): Array<{ address: string; storageKeys: Hex[] }> =>
  accessList.map((entry) => ({
    address: entry.address,
    storageKeys: [...entry.storageKeys],
  }));

const gasEstimateRequest = (transaction: PreparedWithoutGas): GasEstimateRequest => {
  const common = {
    from: transaction.from,
    ...(transaction.to === null ? {} : { to: transaction.to }),
    value: transaction.value,
    data: transaction.data,
  };

  switch (transaction.type) {
    case "legacy":
      return { ...common, gasPrice: transaction.gasPrice };
    case "eip2930":
      return {
        ...common,
        type: "0x1",
        gasPrice: transaction.gasPrice,
        accessList: rpcAccessList(transaction.accessList),
      };
    case "eip1559":
      return {
        ...common,
        type: "0x2",
        maxFeePerGas: transaction.maxFeePerGas,
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
        accessList: rpcAccessList(transaction.accessList),
      };
  }
};

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

  const getGasPrice = (chainRef: ChainRef): Promise<Hex> =>
    params.chainJsonRpc.request<Hex>({
      chainRef,
      method: "eth_gasPrice",
      replay: "allowed",
    });

  const completeEip1559Fees = async (
    chainRef: ChainRef,
    baseFeePerGas: Hex,
    requested: Readonly<{
      maxFeePerGas?: Hex | undefined;
      maxPriorityFeePerGas?: Hex | undefined;
    }>,
  ): Promise<Eip1559Fees> => {
    const maxPriorityFeePerGas =
      requested.maxPriorityFeePerGas ??
      (await params.chainJsonRpc.request<Hex>({
        chainRef,
        method: "eth_maxPriorityFeePerGas",
        replay: "allowed",
      }));
    const maxFeePerGas =
      requested.maxFeePerGas ??
      HexNumber.fromNumber(HexNumber.toBigInt(baseFeePerGas) * 2n + HexNumber.toBigInt(maxPriorityFeePerGas));

    if (HexNumber.toBigInt(maxPriorityFeePerGas) > HexNumber.toBigInt(maxFeePerGas)) {
      throw new Eip155PriorityFeeExceedsMaxFeeError({ maxFeePerGas, maxPriorityFeePerGas });
    }

    return { maxFeePerGas, maxPriorityFeePerGas };
  };

  const completeGas = async <TTransaction extends PreparedWithoutGas>(
    chainRef: ChainRef,
    transaction: TTransaction,
    requestedGas: Hex | undefined,
    nonce: Hex | undefined,
  ): Promise<TTransaction & Readonly<{ gas: Hex; nonce?: Hex }>> => {
    const gas =
      requestedGas ??
      (await params.chainJsonRpc.request<Hex>({
        chainRef,
        method: "eth_estimateGas",
        params: [gasEstimateRequest(transaction)],
        replay: "allowed",
      }));

    return {
      ...transaction,
      gas,
      ...(nonce === undefined ? {} : { nonce }),
    };
  };

  return async (input) => {
    const request = input.transaction;
    const common = {
      from: input.from,
      to:
        request.to === undefined || request.to === null
          ? null
          : addressFormat.canonicalize({ chainRef: input.chainRef, value: request.to }).canonical,
      value: request.value ?? ("0x0" as Hex),
      data: request.data ?? ("0x" as Hex),
    };

    let transaction: PreparedWithoutGas;
    switch (request.type) {
      case "auto": {
        const baseFeePerGas = await getLatestBlockBaseFee(input.chainRef);
        if (baseFeePerGas === undefined) {
          transaction = { ...common, type: "legacy", gasPrice: await getGasPrice(input.chainRef) };
        } else {
          transaction = {
            ...common,
            type: "eip1559",
            ...(await completeEip1559Fees(input.chainRef, baseFeePerGas, {})),
            accessList: [],
          };
        }
        break;
      }
      case "legacy":
        transaction = {
          ...common,
          type: "legacy",
          gasPrice: request.gasPrice ?? (await getGasPrice(input.chainRef)),
        };
        break;
      case "eip2930":
        transaction = {
          ...common,
          type: "eip2930",
          gasPrice: request.gasPrice ?? (await getGasPrice(input.chainRef)),
          accessList: request.accessList ?? [],
        };
        break;
      case "eip1559": {
        const baseFeePerGas = await getLatestBlockBaseFee(input.chainRef);
        if (baseFeePerGas === undefined) throw new Eip155FeeModelUnsupportedError(input.chainRef);

        transaction = {
          ...common,
          type: "eip1559",
          ...(await completeEip1559Fees(input.chainRef, baseFeePerGas, request)),
          accessList: request.accessList ?? [],
        };
        break;
      }
    }

    createEip155TransactionEnvelope(input.chainRef, transaction);
    return completeGas(input.chainRef, transaction, request.gas, request.nonce);
  };
};
