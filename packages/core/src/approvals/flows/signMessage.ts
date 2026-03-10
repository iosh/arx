import { ArxReasons, arxError } from "@arx/errors";
import { toAccountIdFromAddress } from "../../accounts/addressing/accountId.js";
import { ApprovalKinds } from "../../controllers/approval/types.js";
import { PermissionCapabilities } from "../../controllers/permission/types.js";
import { createApprovalSummaryBase } from "../presentation.js";
import { deriveApprovalReviewContext, parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const signMessageApprovalFlow: ApprovalFlow<typeof ApprovalKinds.SignMessage> = {
  kind: ApprovalKinds.SignMessage,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.SignMessage, input),
  present(record, deps) {
    return {
      ...createApprovalSummaryBase(record, deps, { request: record.request }),
      type: "signMessage",
      payload: {
        from: String(record.request.from ?? ""),
        message: String(record.request.message ?? ""),
      },
    };
  },
  async approve(record, _decision, deps) {
    const payload = record.request;
    const { reviewChainRef, namespace } = deriveApprovalReviewContext(record, { request: payload });
    const chainRef = reviewChainRef;

    if (namespace !== "eip155") {
      throw arxError({
        reason: ArxReasons.ChainNotCompatible,
        message: `SignMessage is not supported for namespace "${namespace}".`,
        data: { namespace, chainRef },
      });
    }

    const signature = await deps.signers.eip155.signPersonalMessage({
      accountId: toAccountIdFromAddress({ chainRef, address: payload.from }),
      message: payload.message,
    });

    await deps.permissions.grant(record.origin, PermissionCapabilities.Sign, { namespace, chainRef });
    return signature;
  },
};
