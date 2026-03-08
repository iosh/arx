import { ArxReasons, arxError } from "@arx/errors";
import { toAccountIdFromAddress } from "../../accounts/addressing/accountId.js";
import { ApprovalKinds } from "../../controllers/approval/types.js";
import { PermissionCapabilities } from "../../controllers/permission/types.js";
import { deriveApprovalChainContext, parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const signMessageApprovalFlow: ApprovalFlow<typeof ApprovalKinds.SignMessage> = {
  kind: ApprovalKinds.SignMessage,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.SignMessage, input),
  async approve(record, _decision, deps) {
    const payload = record.request;
    const { chainRef, namespace } = deriveApprovalChainContext(record, deps, payload);

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
