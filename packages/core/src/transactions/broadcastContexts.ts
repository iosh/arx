import { canonicalChainAddressFromAccountId } from "../accounts/addressing/accountId.js";
import type { AccountAddressingByNamespace } from "../accounts/addressing/addressing.js";
import { type TransactionAggregate, TransactionAggregateInvariantError } from "./aggregate/index.js";
import type {
  BroadcastArtifact,
  TransactionBroadcastArtifactContext,
  TransactionBroadcastContext,
} from "./namespace/types.js";

const readAggregateFromAddress = (aggregate: TransactionAggregate, accountAddressing: AccountAddressingByNamespace) => {
  return canonicalChainAddressFromAccountId({
    accountAddressing,
    chainRef: aggregate.record.chainRef,
    accountId: aggregate.record.accountId,
  });
};

const requireApprovedPayload = (aggregate: TransactionAggregate) => {
  const approvedRequest = aggregate.record.approvedRequest;
  if (!approvedRequest) {
    throw new TransactionAggregateInvariantError(
      aggregate.record.id,
      `Transaction "${aggregate.record.id}" is missing an approved request payload.`,
    );
  }
  return approvedRequest.payload;
};

export const buildBroadcastArtifactContext = (
  aggregate: TransactionAggregate,
  accountAddressing: AccountAddressingByNamespace,
): TransactionBroadcastArtifactContext => ({
  transactionId: aggregate.record.id,
  namespace: aggregate.record.namespace,
  chainRef: aggregate.record.chainRef,
  origin: aggregate.record.origin,
  accountId: aggregate.record.accountId,
  from: readAggregateFromAddress(aggregate, accountAddressing),
  request: {
    namespace: aggregate.record.namespace,
    chainRef: aggregate.record.chainRef,
    payload: structuredClone(aggregate.record.request.payload as Record<string, unknown>),
  },
  approvedPayload: structuredClone(requireApprovedPayload(aggregate) as Record<string, unknown>),
});

export const buildBroadcastContext = (
  aggregate: TransactionAggregate,
  broadcastArtifact: BroadcastArtifact,
  accountAddressing: AccountAddressingByNamespace,
): TransactionBroadcastContext => ({
  ...buildBroadcastArtifactContext(aggregate, accountAddressing),
  broadcastArtifact: structuredClone(broadcastArtifact),
});
