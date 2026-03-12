import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds } from "../../controllers/approval/types.js";
import { PermissionCapabilities, type PermissionRequestDescriptor } from "../../controllers/permission/types.js";
import { createApprovalSummaryBase } from "../presentation.js";
import { deriveApprovalReviewContext, parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const requestPermissionsApprovalFlow: ApprovalFlow<typeof ApprovalKinds.RequestPermissions> = {
  kind: ApprovalKinds.RequestPermissions,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.RequestPermissions, input),
  present(record, deps) {
    return {
      ...createApprovalSummaryBase(record, deps, { request: record.request }),
      type: "requestPermissions",
      payload: {
        requestedAccesses: record.request.requested.flatMap((item) =>
          item.chainRefs.map((chainRef) => ({
            capability: item.capability,
            chainRef,
          })),
        ),
      },
    };
  },
  async approve(record, _decision, deps) {
    const granted = record.request.requested.map((descriptor) => ({
      capability: descriptor.capability,
      chainRefs: [...descriptor.chainRefs] as PermissionRequestDescriptor["chainRefs"],
    }));

    const requestedChainRefs = new Set<string>();
    let namespace: string | null = null;

    for (const descriptor of granted) {
      if (descriptor.capability !== PermissionCapabilities.Accounts) {
        throw arxError({
          reason: ArxReasons.RpcInvalidParams,
          message: `Unsupported permission capability "${descriptor.capability}"`,
          data: { origin: record.origin, capability: descriptor.capability },
        });
      }

      for (const targetChainRef of descriptor.chainRefs) {
        const context = deriveApprovalReviewContext(record, {
          request: { chainRef: targetChainRef },
        });
        namespace = context.namespace;
        requestedChainRefs.add(context.reviewChainRef);
      }
    }

    if (!namespace || requestedChainRefs.size === 0) {
      throw arxError({
        reason: ArxReasons.RpcInternal,
        message: "Permission request approval is missing connection context",
        data: { origin: record.origin },
      });
    }

    const existing = deps.permissions.getAuthorization(record.origin, { namespace });
    const primaryChainRef = granted[0]?.chainRefs[0] ?? record.request.chainRef;
    const { reviewChainRef } = deriveApprovalReviewContext(record, {
      request: { chainRef: primaryChainRef },
    });
    const accounts = deps.accounts.listOwnedForNamespace({ namespace, chainRef: reviewChainRef });
    const activeAccount = deps.accounts.getActiveAccountForNamespace({ namespace, chainRef: reviewChainRef });
    const selectedAccount =
      (activeAccount && accounts.find((account) => account.accountId === activeAccount.accountId)) ??
      accounts[0] ??
      null;

    if (!selectedAccount) {
      throw arxError({
        reason: ArxReasons.PermissionDenied,
        message: "No selectable account available for permission request",
        data: { origin: record.origin, chainRef: reviewChainRef, namespace },
      });
    }

    const nextChains = new Map<string, string[]>(
      Object.entries(existing?.chains ?? {}).map(([chainRef, chainState]) => [chainRef, [...chainState.accountIds]]),
    );
    for (const chainRef of requestedChainRefs) {
      const current = nextChains.get(chainRef) ?? [];
      nextChains.set(chainRef, [...new Set([...current, selectedAccount.accountId])]);
    }

    await deps.permissions.upsertAuthorization(record.origin, {
      namespace,
      chains: [...nextChains.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([chainRef, accountIds]) => ({
          chainRef: chainRef as typeof primaryChainRef,
          accountIds,
        })) as [
        { chainRef: typeof primaryChainRef; accountIds: string[] },
        ...Array<{ chainRef: typeof primaryChainRef; accountIds: string[] }>,
      ],
    });

    return { granted };
  },
};
