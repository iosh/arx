import { ArxReasons, arxError } from "@arx/errors";
import type { UiMethodResult } from "../../protocol/index.js";
import type { UiHandlers, UiRuntimeDeps } from "../types.js";

export const createApprovalsHandlers = (
  deps: Pick<UiRuntimeDeps, "controllers" | "chainViews">,
): Pick<UiHandlers, "ui.approvals.approve" | "ui.approvals.reject"> => {
  return {
    "ui.approvals.approve": async ({ id }) => {
      const task = deps.controllers.approvals.get(id);
      if (!task) {
        throw arxError({ reason: ArxReasons.RpcInvalidParams, message: "Approval not found", data: { id } });
      }

      const resolved = await deps.controllers.approvals.resolve({ id: task.id, action: "approve" });
      return {
        id: resolved.id,
        result: resolved.value as UiMethodResult<"ui.approvals.approve">["result"],
      };
    },

    "ui.approvals.reject": async ({ id, reason }) => {
      const task = deps.controllers.approvals.get(id);
      if (!task) {
        throw arxError({ reason: ArxReasons.RpcInvalidParams, message: "Approval not found", data: { id } });
      }

      await deps.controllers.approvals.resolve({
        id: task.id,
        action: "reject",
        ...(reason !== undefined ? { reason } : {}),
      });
      return { id: task.id };
    },
  };
};
