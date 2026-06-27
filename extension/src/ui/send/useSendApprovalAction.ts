import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { app } from "@/ui/lib/app";
import { getErrorMessage } from "@/ui/lib/errorUtils";

export type SendApprovalInput = Parameters<typeof app.wallet.transactions.requestSendTransactionApproval>[0];

/** Owns the send page's submission state and approval navigation flow. */
export function useSendApprovalAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function submitSendApproval(input: SendApprovalInput): Promise<boolean> {
    if (pending) return false;

    setPending(true);
    setErrorMessage(null);

    try {
      const { approvalId } = await app.wallet.transactions.requestSendTransactionApproval(input);
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
