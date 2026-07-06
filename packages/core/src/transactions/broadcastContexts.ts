import { canonicalChainAddressFromAccountId } from "../accounts/addressing/accountId.js";
import type { AccountAddressingByNamespace } from "../accounts/addressing/addressing.js";
import type { TransactionAggregate } from "./aggregate/index.js";
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
    payload: structuredClone(aggregate.record.request.payload),
  },
  approvedPayload: structuredClone(aggregate.record.approvedRequest.payload),
});

export const buildBroadcastContext = (
  aggregate: TransactionAggregate,
  broadcastArtifact: BroadcastArtifact,
  accountAddressing: AccountAddressingByNamespace,
): TransactionBroadcastContext => ({
  ...buildBroadcastArtifactContext(aggregate, accountAddressing),
  broadcastArtifact: structuredClone(broadcastArtifact),
});
