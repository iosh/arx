import type { Hex } from "ox/Hex";
import type { ChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import type { ChainRef } from "../../networks/chainRef.js";
import * as HexQuantity from "../../utils/hex.js";
import type { PendingTransactionRecord } from "../persistence.js";
import type * as Eip155 from "./types.js";

type Eip155NonceInput = Readonly<{
  chainRef: ChainRef;
  transaction: Eip155.PreparedTransaction;
}>;

type Eip155NonceCoordinator = Readonly<{
  withTransactionNonce<T>(
    input: Eip155NonceInput,
    use: (transaction: Eip155.SignableTransaction) => Promise<T>,
  ): Promise<T>;
}>;

type Eip155NonceCoordinatorOptions = Readonly<{
  chainJsonRpc: ChainJsonRpc;
  listPending(): Promise<readonly PendingTransactionRecord[]>;
}>;

const withSenderQueue = async <T>(
  tails: Map<string, Promise<void>>,
  key: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  tails.set(key, current);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (tails.get(key) === current) tails.delete(key);
  }
};

const getSenderKey = (input: Eip155NonceInput): string => `${input.chainRef}/${input.transaction.from.toLowerCase()}`;

const getNextNonce = (
  networkNonce: Hex,
  records: readonly PendingTransactionRecord[],
  input: Eip155NonceInput,
): Hex => {
  const sender = input.transaction.from.toLowerCase();
  const occupied = new Set<bigint>();

  for (const record of records) {
    if (record.chainRef !== input.chainRef || record.transaction.from.toLowerCase() !== sender) continue;
    occupied.add(HexQuantity.toBigInt(record.transaction.nonce));
  }

  let nonce = HexQuantity.toBigInt(networkNonce);
  while (occupied.has(nonce)) nonce += 1n;
  return HexQuantity.fromNumber(nonce);
};

export const createEip155NonceCoordinator = (params: Eip155NonceCoordinatorOptions): Eip155NonceCoordinator => {
  const tails = new Map<string, Promise<void>>();

  return {
    withTransactionNonce(input, use) {
      return withSenderQueue(tails, getSenderKey(input), async () => {
        const explicitNonce = input.transaction.nonce;
        if (explicitNonce !== undefined) {
          return use({ ...input.transaction, nonce: explicitNonce });
        }

        const pendingRecords = await params.listPending();
        const networkNonce = await params.chainJsonRpc.request<Hex>({
          chainRef: input.chainRef,
          method: "eth_getTransactionCount",
          params: [input.transaction.from, "pending"],
          replay: "allowed",
        });
        return use({ ...input.transaction, nonce: getNextNonce(networkNonce, pendingRecords, input) });
      });
    },
  };
};
