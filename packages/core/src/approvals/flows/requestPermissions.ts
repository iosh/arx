import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds } from "../../controllers/approval/types.js";
import { ConnectionGrantKinds, type ConnectionGrantRequest } from "../../controllers/permission/types.js";
import { createApprovalSummaryBase } from "../presentation.js";
import {
  deriveApprovalReviewContext,
  getApprovalSelectableAccounts,
  parseAccountSelectionDecision,
  resolveApprovalSelectedAccounts,
} from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const requestPermissionsApprovalFlow: ApprovalFlow<typeof ApprovalKinds.RequestPermissions> = {
  kind: ApprovalKinds.RequestPermissions,
  parseDecision: (input) => parseAccountSelectionDecision(ApprovalKinds.RequestPermissions, input),
  present(record, deps) {
    const { selectableAccounts, recommendedAccountKey } = getApprovalSelectableAccounts(record, deps, {
      request: record.request,
    });

    return {
      ...createApprovalSummaryBase(record, deps, { request: record.request }),
      type: "requestPermissions",
      payload: {
        selectableAccounts: selectableAccounts.map((account) => ({
          accountKey: account.accountKey,
          canonicalAddress: account.canonicalAddress,
          displayAddress: account.displayAddress,
        })),
        recommendedAccountKey,
        requestedGrants: record.request.requestedGrants.flatMap((item) =>
          item.chainRefs.map((chainRef) => ({
            grantKind: item.grantKind,
            chainRef,
          })),
        ),
      },
    };
  },
  async approve(record, decision, deps) {
    const grantedGrants = record.request.requestedGrants.map((descriptor) => ({
      grantKind: descriptor.grantKind,
      chainRefs: [...descriptor.chainRefs] as ConnectionGrantRequest["chainRefs"],
    }));

    const requestedChainRefs = new Set<string>();
    let namespace: string | null = null;

    for (const descriptor of grantedGrants) {
      if (descriptor.grantKind !== ConnectionGrantKinds.Accounts) {
        throw arxError({
          reason: ArxReasons.RpcInvalidParams,
          message: `Unsupported connection grant kind "${descriptor.grantKind}"`,
          data: { origin: record.origin, grantKind: descriptor.grantKind },
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
    const primaryChainRef = grantedGrants[0]?.chainRefs[0] ?? record.request.chainRef;
    const { reviewChainRef } = deriveApprovalReviewContext(record, {
      request: { chainRef: primaryChainRef },
    });
    const { selectableAccounts } = getApprovalSelectableAccounts(record, deps, {
      request: { chainRef: primaryChainRef },
    });

    if (selectableAccounts.length === 0) {
      throw arxError({
        reason: ArxReasons.PermissionDenied,
        message: "No selectable account available for permission request",
        data: { origin: record.origin, chainRef: reviewChainRef, namespace },
      });
    }

    const selectedAccounts = resolveApprovalSelectedAccounts({
      record,
      namespace,
      chainRef: reviewChainRef,
      decision,
      selectableAccounts,
    });

    const nextChains = new Map<string, string[]>(
      Object.entries(existing?.chains ?? {}).map(([chainRef, chainState]) => [chainRef, [...chainState.accountKeys]]),
    );
    for (const chainRef of requestedChainRefs) {
      nextChains.set(
        chainRef,
        selectedAccounts.map((account) => account.accountKey),
      );
    }

    await deps.permissions.upsertAuthorization(record.origin, {
      namespace,
      chains: [...nextChains.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([chainRef, accountKeys]) => ({
          chainRef: chainRef as typeof primaryChainRef,
          accountKeys,
        })) as [
        { chainRef: typeof primaryChainRef; accountKeys: string[] },
        ...Array<{ chainRef: typeof primaryChainRef; accountKeys: string[] }>,
      ],
    });

    return { grantedGrants };
  },
};
