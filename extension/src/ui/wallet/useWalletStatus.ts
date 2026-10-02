import type { WalletStatus } from "@arx/core/wallet";
import { useEffect, useState } from "react";
import { useWalletClient } from "./WalletClientContext";

export function useWalletStatus() {
  const wallet = useWalletClient();
  const [status, setStatus] = useState<WalletStatus | "loading" | "error">("loading");

  useEffect(() => {
    const unsubscribe = wallet.subscribe((event) => {
      if (event.type === "walletStatusChanged") setStatus(event.status);
    });
    void wallet.getStatus().then(
      // A status event also completes the initial read; its snapshot takes precedence.
      (initial) => setStatus((current) => (current === "loading" ? initial : current)),
      () => setStatus((current) => (current === "loading" ? "error" : current)),
    );
    return unsubscribe;
  }, [wallet]);

  return status;
}
