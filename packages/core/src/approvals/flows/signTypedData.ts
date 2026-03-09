import { ArxReasons, arxError } from "@arx/errors";
import { toAccountIdFromAddress } from "../../accounts/addressing/accountId.js";
import { ApprovalKinds } from "../../controllers/approval/types.js";
import { PermissionCapabilities } from "../../controllers/permission/types.js";
import { createApprovalSummaryBase } from "../presentation.js";
import { ApprovalChainDerivationFallbacks, deriveApprovalChainContext, parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const signTypedDataApprovalFlow: ApprovalFlow<typeof ApprovalKinds.SignTypedData> = {
  kind: ApprovalKinds.SignTypedData,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.SignTypedData, input),
  present(record, deps) {
    return {
      ...createApprovalSummaryBase(record, deps, {
        request: record.request,
        fallback: ApprovalChainDerivationFallbacks.None,
      }),
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
    const { chainRef, namespace } = deriveApprovalChainContext(record, deps, {
      request: payload,
      fallback: ApprovalChainDerivationFallbacks.None,
    });

    if (namespace !== "eip155") {
      throw arxError({
        reason: ArxReasons.ChainNotCompatible,
        message: `SignTypedData is not supported for namespace "${namespace}".`,
        data: { namespace, chainRef },
      });
    }

    const signature = await deps.signers.eip155.signTypedData({
      accountId: toAccountIdFromAddress({ chainRef, address: payload.from }),
      typedData: payload.typedData,
    });

    await deps.permissions.grant(record.origin, PermissionCapabilities.Sign, { namespace, chainRef });
    return signature;
  },
};
