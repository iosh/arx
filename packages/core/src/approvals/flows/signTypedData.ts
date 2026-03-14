import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds } from "../../controllers/approval/types.js";
import { createApprovalSummaryBase } from "../presentation.js";
import { deriveApprovalReviewContext, parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const signTypedDataApprovalFlow: ApprovalFlow<typeof ApprovalKinds.SignTypedData> = {
  kind: ApprovalKinds.SignTypedData,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.SignTypedData, input),
  present(record, deps) {
    return {
      ...createApprovalSummaryBase(record, deps, { request: record.request }),
      type: "signTypedData",
      payload: {
        from: String(record.request.from ?? ""),
        typedData:
          typeof record.request.typedData === "string"
            ? record.request.typedData
            : JSON.stringify(record.request.typedData ?? {}),
      },
    };
  },
  async approve(record, _decision, deps) {
    const payload = record.request;
    const { reviewChainRef, namespace } = deriveApprovalReviewContext(record, { request: payload });
    const chainRef = reviewChainRef;
    const approvalBindings = deps.namespaceBindings.getApproval(namespace);
    if (!approvalBindings?.signTypedData) {
      throw arxError({
        reason: ArxReasons.ChainNotCompatible,
        message: `SignTypedData is not supported for namespace "${namespace}".`,
        data: { namespace, chainRef },
      });
    }

    const signature = await approvalBindings.signTypedData({
      chainRef,
      address: payload.from,
      typedData: payload.typedData,
    });

    return signature;
  },
};
