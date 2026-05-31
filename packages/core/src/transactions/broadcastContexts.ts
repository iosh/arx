import type { AccountCodecRegistry } from "../accounts/addressing/codec.js";
import type { TransactionAggregate } from "./aggregate/index.js";
import type {
  BroadcastInput,
  TransactionBroadcastContext,
  TransactionBroadcastInputContext,
} from "./namespace/types.js";

const readAggregateFromAddress = (
  aggregate: TransactionAggregate,
  accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">,
) => {
  return accountCodecs.toCanonicalAddressFromAccountKey({
    accountKey: aggregate.record.accountKey,
  });
};

const requireApprovedPayload = (aggregate: TransactionAggregate) => {
  const approvedRequest = aggregate.record.approvedRequest;
  if (!approvedRequest) {
    throw new Error(`Transaction "${aggregate.record.id}" is missing an approved request payload.`);
  }
  return approvedRequest.payload;
};

export const buildBroadcastInputContext = (
  aggregate: TransactionAggregate,
  accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">,
): TransactionBroadcastInputContext => ({
  transactionId: aggregate.record.id,
  namespace: aggregate.record.namespace,
  chainRef: aggregate.record.chainRef,
  origin: aggregate.record.origin,
  accountKey: aggregate.record.accountKey,
  from: readAggregateFromAddress(aggregate, accountCodecs),
  request: {
    namespace: aggregate.record.namespace,
    chainRef: aggregate.record.chainRef,
    payload: structuredClone(aggregate.record.request.payload as Record<string, unknown>),
  },
  approvedPayload: structuredClone(requireApprovedPayload(aggregate) as Record<string, unknown>),
});

export const buildBroadcastContext = (
  aggregate: TransactionAggregate,
  broadcastInput: BroadcastInput,
  accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">,
): TransactionBroadcastContext => ({
  ...buildBroadcastInputContext(aggregate, accountCodecs),
  broadcastInput: structuredClone(broadcastInput),
});
