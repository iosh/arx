import type { AccessList } from "ox/AccessList";
import type { Address } from "ox/Address";
import type { Hex } from "ox/Hex";
import { fromNumber } from "ox/Hex";
import type { ChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import type { ChainRef } from "../../networks/chainRef.js";
import { Eip155FeeModelUnsupportedError, Eip155PriorityFeeExceedsMaxFeeError } from "./errors.js";
import { replacementFee } from "./replacementTransaction.js";
import { createEip155TransactionEnvelope } from "./transactionEnvelope.js";
import type * as Eip155 from "./types.js";

type PreparationInput = Readonly<{
  chainRef: ChainRef;
  from: Address;
  transaction: Eip155.TransactionRequest;
  replacement?: Eip155.SignableTransaction;
}>;

type PreparedWithoutGas =
  | Omit<Eip155.LegacyPreparedTransaction, "gas">
  | Omit<Eip155.Eip2930PreparedTransaction, "gas">
  | Omit<Eip155.Eip1559PreparedTransaction, "gas">;

type GasEstimateRequest = Readonly<{
  from: string;
  to?: string;
  value: Hex;
  data: Hex;
  nonce?: Hex;
  type?: "0x1" | "0x2";
  gasPrice?: Hex;
  maxFeePerGas?: Hex;
  maxPriorityFeePerGas?: Hex;
  accessList?: Array<{ address: string; storageKeys: Hex[] }>;
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

const gasEstimateRequest = (transaction: PreparedWithoutGas, nonce?: Hex): GasEstimateRequest => {
  const common = {
    from: transaction.from,
    ...(transaction.to === null ? {} : { to: transaction.to }),
    value: transaction.value,
    data: transaction.data,
    ...(nonce === undefined ? {} : { nonce: fromNumber(BigInt(nonce)) }),
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

export const createEip155TransactionPreparer = ({
  chainJsonRpc,
}: {
  chainJsonRpc: ChainJsonRpc;
}): Eip155TransactionPreparer => {
  const getLatestBlockBaseFee = async (chainRef: ChainRef): Promise<Hex | undefined> => {
    const { baseFeePerGas } = await chainJsonRpc.request<{ baseFeePerGas?: Hex }>({
      chainRef,
      method: "eth_getBlockByNumber",
      params: ["latest", false],
    });
    return baseFeePerGas;
  };

  const getGasPrice = (chainRef: ChainRef) =>
    chainJsonRpc.request<Hex>({
      chainRef,
      method: "eth_gasPrice",
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
      (await chainJsonRpc.request<Hex>({
        chainRef,
        method: "eth_maxPriorityFeePerGas",
      }));
    const maxFeePerGas =
      requested.maxFeePerGas ?? fromNumber(BigInt(baseFeePerGas) * 2n + BigInt(maxPriorityFeePerGas));

    if (BigInt(maxPriorityFeePerGas) > BigInt(maxFeePerGas)) {
      throw new Eip155PriorityFeeExceedsMaxFeeError({ maxFeePerGas, maxPriorityFeePerGas });
    }

    return { maxFeePerGas, maxPriorityFeePerGas };
  };

  const completeGasPrice = async (input: PreparationInput, requested: Hex | undefined): Promise<Hex> => {
    const estimate = requested ?? (await getGasPrice(input.chainRef));
    const previous = input.replacement;
    return previous && previous.type !== "eip1559" ? replacementFee(previous.gasPrice, estimate) : estimate;
  };

  return async (input) => {
    const request = input.transaction;
    const previous = input.replacement;
    const common = {
      from: input.from,
      to: request.to ?? null,
      value: request.value ?? ("0x0" as const),
      data: request.data ?? ("0x" as const),
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
          gasPrice: await completeGasPrice(input, request.gasPrice),
        };
        break;
      case "eip2930":
        transaction = {
          ...common,
          type: "eip2930",
          gasPrice: await completeGasPrice(input, request.gasPrice),
          accessList: request.accessList ?? [],
        };
        break;
      case "eip1559": {
        const baseFeePerGas = await getLatestBlockBaseFee(input.chainRef);
        if (baseFeePerGas === undefined) throw new Eip155FeeModelUnsupportedError(input.chainRef);

        const fees = await completeEip1559Fees(input.chainRef, baseFeePerGas, request);
        transaction = {
          ...common,
          type: "eip1559",
          ...(previous?.type === "eip1559"
            ? {
                maxFeePerGas: replacementFee(previous.maxFeePerGas, fees.maxFeePerGas),
                maxPriorityFeePerGas: replacementFee(previous.maxPriorityFeePerGas, fees.maxPriorityFeePerGas),
              }
            : fees),
          accessList: request.accessList ?? [],
        };
        break;
      }
    }

    createEip155TransactionEnvelope(input.chainRef, transaction);
    const gas =
      request.gas ??
      (await chainJsonRpc.request<Hex>({
        chainRef: input.chainRef,
        method: "eth_estimateGas",
        params: [gasEstimateRequest(transaction, previous?.nonce)],
      }));
    return { ...transaction, gas };
  };
};
