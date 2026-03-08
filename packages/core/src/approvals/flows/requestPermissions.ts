import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds } from "../../controllers/approval/types.js";
import { PermissionCapabilities } from "../../controllers/permission/types.js";
import { createApprovalSummaryBase } from "../presentation.js";
import { ApprovalChainDerivationFallbacks, deriveApprovalChainContext, parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const requestPermissionsApprovalFlow: ApprovalFlow<typeof ApprovalKinds.RequestPermissions> = {
  kind: ApprovalKinds.RequestPermissions,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.RequestPermissions, input),
  present(record, deps) {
    return {
      ...createApprovalSummaryBase(record, deps),
      type: "requestPermissions",
      payload: {
        permissions: record.request.requested.map((item) => ({
          capability: item.capability,
          chainRefs: [...item.chainRefs],
        })),
      },
    };
  },
  async approve(record, _decision, deps) {
    const granted = record.request.requested.map((descriptor) => ({
      capability: descriptor.capability,
      chainRefs: [...descriptor.chainRefs],
    }));

    for (const descriptor of granted) {
      const targetChainRefs =
        descriptor.chainRefs.length > 0
          ? descriptor.chainRefs
          : [
              deriveApprovalChainContext(record, deps, {
                fallback: ApprovalChainDerivationFallbacks.NamespaceActive,
              }).chainRef,
            ];

      for (const targetChainRef of targetChainRefs) {
        const { namespace, chainRef } = deriveApprovalChainContext(record, deps, {
          request: { chainRef: targetChainRef },
          fallback: ApprovalChainDerivationFallbacks.NamespaceActive,
        });

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
