import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { requestSendApprovalAndNavigate, type SendApprovalInput } from "./sendApprovalFlow";

/**
 * Owns the send page's submission state and approval handoff behavior.
 */
export function useSendApprovalAction() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function submitSendApproval(input: SendApprovalInput): Promise<boolean> {
    if (pending) return false;

    setPending(true);
    setErrorMessage(null);

    try {
      await requestSendApprovalAndNavigate({
        queryClient,
        input,
        navigateToApprovalRoute: async (approvalId) => {
          await router.navigate({
            to: "/approve/send-transaction/$id",
            params: { id: approvalId },
            replace: true,
          });
        },
      });
      return true;
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      return false;
    } finally {
      setPending(false);
    }
  }

  return {
    pending,
    errorMessage,
    submitSendApproval,
  };
}
