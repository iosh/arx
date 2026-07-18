import type { Accounts } from "../../../../accounts/Accounts.js";
import type { AccountId } from "../../../../accounts/accountId.js";
import { deriveApprovalReviewContext } from "../../../../approvals/chainContext.js";
import type { ApprovalRecord } from "../../../../approvals/queue/types.js";
import { getApprovalSelectableAccounts, resolveApprovalSelectedAccounts } from "../../../../approvals/shared.js";
import type { ChainRef } from "../../../../chains/ids.js";
import type { PermissionsWriter } from "../../../../permissions/service/types.js";

type ConnectionApprovalRecord = Pick<ApprovalRecord, "approvalId" | "kind" | "origin" | "namespace" | "chainRef">;

type GrantAccountsForConnectionApprovalDeps = {
  accounts: Pick<Accounts, "getSelectedAddress" | "listSelectableAddresses">;
  permissions: Pick<PermissionsWriter, "grantAuthorization">;
};

export const grantAccountsForConnectionApproval = async (args: {
  approval: ConnectionApprovalRecord;
  decision: unknown;
  selectionChainRef: ChainRef;
  authorizedChainRefs: readonly [ChainRef, ...ChainRef[]];
  deps: GrantAccountsForConnectionApprovalDeps;
}) => {
  const { approval, decision, selectionChainRef, authorizedChainRefs, deps } = args;
  const { namespace, chainRef, selectableAccounts } = getApprovalSelectableAccounts(approval, deps, {
    request: { chainRef: selectionChainRef },
  });

  const selectedAccounts = resolveApprovalSelectedAccounts({
    record: approval,
    namespace,
    chainRef,
    decision,
    selectableAccounts,
  });
  const accountIds = selectedAccounts.map((account) => account.accountId);
  const chains = [
    ...new Set(
      authorizedChainRefs.map((authorizedChainRef) => {
        return deriveApprovalReviewContext(approval, { request: { chainRef: authorizedChainRef } }).reviewChainRef;
      }),
    ),
  ].sort((left, right) => left.localeCompare(right));

  await deps.permissions.grantAuthorization(approval.origin, {
    namespace,
    chains: chains.map((authorizedChainRef) => ({
      chainRef: authorizedChainRef,
      accountIds,
    })) as [{ chainRef: ChainRef; accountIds: AccountId[] }, ...Array<{ chainRef: ChainRef; accountIds: AccountId[] }>],
  });

  return { selectedAccounts };
};
