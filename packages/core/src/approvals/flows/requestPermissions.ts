import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds } from "../../controllers/approval/types.js";
import { PermissionCapabilities } from "../../controllers/permission/types.js";
import { deriveApprovalChainContext, parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const requestPermissionsApprovalFlow: ApprovalFlow<typeof ApprovalKinds.RequestPermissions> = {
  kind: ApprovalKinds.RequestPermissions,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.RequestPermissions, input),
  async approve(record, _decision, deps) {
    const granted = record.request.requested.map((descriptor) => ({
      capability: descriptor.capability,
      chainRefs: [...descriptor.chainRefs],
    }));

    for (const descriptor of granted) {
      const targetChainRefs =
        descriptor.chainRefs.length > 0 ? descriptor.chainRefs : [deriveApprovalChainContext(record, deps).chainRef];

      for (const targetChainRef of targetChainRefs) {
        const { namespace, chainRef } = deriveApprovalChainContext(record, deps, { chainRef: targetChainRef });

        if (descriptor.capability === PermissionCapabilities.Accounts) {
          const accounts = deps.accounts.listOwnedForNamespace({ namespace, chainRef });
          const activeAccount = deps.accounts.getActiveAccountForNamespace({ namespace, chainRef });
          const selectedAccount =
            (activeAccount && accounts.find((account) => account.accountId === activeAccount.accountId)) ??
            accounts[0] ??
            null;

          if (!selectedAccount) {
            throw arxError({
              reason: ArxReasons.PermissionDenied,
              message: "No selectable account available for permission request",
              data: { origin: record.origin, chainRef, namespace, capability: descriptor.capability },
            });
          }

          await deps.permissions.setPermittedAccounts(record.origin, {
            namespace,
            chainRef,
            accounts: [selectedAccount.canonicalAddress],
          });
          continue;
        }

        await deps.permissions.grant(record.origin, descriptor.capability, { namespace, chainRef });
      }
    }

    return { granted };
  },
};
