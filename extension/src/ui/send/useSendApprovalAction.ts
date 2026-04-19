import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { uiClient } from "@/ui/lib/uiBridgeClient";

export type SendApprovalInput = Parameters<typeof uiClient.transactions.requestSendTransactionApproval>[0];

/**
 * Owns the send page's submission state and approval handoff behavior.
 */
export function useSendApprovalAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function submitSendApproval(input: SendApprovalInput): Promise<boolean> {
    if (pending) return false;

    setPending(true);
    setErrorMessage(null);

    try {
      const { approvalId } = await uiClient.transactions.requestSendTransactionApproval(input);
      await router.navigate({
        to: "/approve/$approvalId",
        params: { approvalId },
        replace: true,
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
