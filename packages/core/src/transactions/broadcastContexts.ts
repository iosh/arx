import type { AccountAddressCodecs } from "../accounts/accountAddressCodec.js";
import { addressFromAccountId } from "../accounts/accountId.js";
import type { TransactionAggregate } from "./aggregate/index.js";
import type {
  BroadcastArtifact,
  TransactionBroadcastArtifactContext,
  TransactionBroadcastContext,
} from "./namespace/types.js";

const readAggregateFromAddress = (aggregate: TransactionAggregate, accountAddressCodecs: AccountAddressCodecs) => {
  return addressFromAccountId({
    accountAddressCodecs,
    chainRef: aggregate.record.chainRef,
    accountId: aggregate.record.accountId,
  });
};

export const buildBroadcastArtifactContext = (
  aggregate: TransactionAggregate,
  accountAddressCodecs: AccountAddressCodecs,
): TransactionBroadcastArtifactContext => ({
  transactionId: aggregate.record.id,
  namespace: aggregate.record.namespace,
  chainRef: aggregate.record.chainRef,
  origin: aggregate.record.origin,
  accountId: aggregate.record.accountId,
  from: readAggregateFromAddress(aggregate, accountAddressCodecs),
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
  accountAddressCodecs: AccountAddressCodecs,
): TransactionBroadcastContext => ({
  ...buildBroadcastArtifactContext(aggregate, accountAddressCodecs),
  broadcastArtifact: structuredClone(broadcastArtifact),
});
