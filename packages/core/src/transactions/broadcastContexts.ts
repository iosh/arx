import type { Accounts } from "../accounts/Accounts.js";
import type { TransactionAggregate } from "./aggregate/index.js";
import type {
  BroadcastArtifact,
  TransactionBroadcastArtifactContext,
  TransactionBroadcastContext,
} from "./namespace/types.js";

const readAggregateFromAddress = (aggregate: TransactionAggregate, accounts: Pick<Accounts, "getAddress">) => {
  return accounts.getAddress({
    chainRef: aggregate.record.chainRef,
    accountId: aggregate.record.accountId,
  }).canonicalAddress;
};

export const buildBroadcastArtifactContext = (
  aggregate: TransactionAggregate,
  accounts: Pick<Accounts, "getAddress">,
): TransactionBroadcastArtifactContext => ({
  transactionId: aggregate.record.id,
  namespace: aggregate.record.namespace,
  chainRef: aggregate.record.chainRef,
  origin: aggregate.record.origin,
  accountId: aggregate.record.accountId,
  from: readAggregateFromAddress(aggregate, accounts),
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
  accounts: Pick<Accounts, "getAddress">,
): TransactionBroadcastContext => ({
  ...buildBroadcastArtifactContext(aggregate, accounts),
  broadcastArtifact: structuredClone(broadcastArtifact),
});
