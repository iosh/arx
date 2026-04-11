import type { UiMethodParams } from "@arx/core/ui";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useUiEntryMetadata } from "@/ui/hooks/useUiEntryMetadata";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { ROUTES } from "@/ui/lib/routes";
import { uiClient } from "@/ui/lib/uiBridgeClient";

export type ApprovalPendingAction = UiMethodParams<"ui.approvals.resolve">["action"] | null;

export function useApprovalResolveAction() {
  const router = useRouter();
  const entry = useUiEntryMetadata();
  const [pendingAction, setPendingAction] = useState<ApprovalPendingAction>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function submitResolution(input: UiMethodParams<"ui.approvals.resolve">): Promise<boolean> {
    setPendingAction(input.action);
    setErrorMessage(null);

    try {
      await uiClient.approvals.resolve(input);
      if (entry.environment === "popup") {
        await router.navigate({ to: ROUTES.APPROVALS, replace: true });
      }
      return true;
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      return false;
    } finally {
      setPendingAction(null);
    }
  }

  function showError(message: string) {
    setErrorMessage(message);
  }

  function clearError() {
    setErrorMessage(null);
  }

  return {
    pendingAction,
    errorMessage,
    submitResolution,
    showError,
    clearError,
  };
}
