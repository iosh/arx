import type { ChainRef } from "../chains/ids.js";
import { eventTopic } from "../messenger/topic.js";
import type { AccountId } from "../storage/records.js";

export type OwnerChangedEvent =
  | { topic: "session"; change: "state" }
  | { topic: "identity"; change: "account"; accountId: AccountId }
  | { topic: "identity"; change: "keyring"; keyringId: string }
  | { topic: "identity"; change: "selection"; namespace: string }
  | { topic: "identity"; change: "all" }
  | { topic: "network"; change: "selection"; namespace: string; chainRef: ChainRef | null }
  | { topic: "network"; change: "chain"; chainRef: ChainRef }
  | { topic: "network"; change: "rpc"; chainRef: ChainRef }
  | { topic: "approvals"; change: "queue"; approvalId: string }
  | { topic: "approvals"; change: "transactionApproval"; approvalIds: readonly string[] }
  | { topic: "attention"; change: "state" }
  | { topic: "transactions"; change: "records"; transactionIds: readonly string[] };

export const OWNER_CHANGED = eventTopic<OwnerChangedEvent>("owner:changed");
