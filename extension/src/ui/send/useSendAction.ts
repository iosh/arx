import { useState } from "react";
import { app } from "@/ui/lib/app";
import { getErrorMessage } from "@/ui/lib/errorUtils";

export type PrepareInput = Parameters<typeof app.wallet.transactions.prepareTransaction>[0];

export function useSendAction() {
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function prepareTransaction(input: PrepareInput) {
    if (pending) {
      return null;
    }

    setPending(true);
    setErrorMessage(null);

    try {
      return await app.wallet.transactions.prepareTransaction(input);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      return null;
    } finally {
      setPending(false);
    }
  }

  return {
    pending,
    errorMessage,
    prepareTransaction,
  };
}
