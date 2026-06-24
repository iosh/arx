import type { WalletApiSessionStatusResult } from "@arx/core/wallet";
import type { ReactNode } from "react";
import { UnlockScreen } from "@/ui/screens/UnlockScreen";
import { LoadingScreen } from "./LoadingScreen";

type SessionGateProps = {
  sessionStatus?: WalletApiSessionStatusResult;
  isLoading: boolean;
  unlock: (password: string) => Promise<unknown>;
  children: ReactNode;
};

export function SessionGate({ sessionStatus, isLoading, unlock, children }: SessionGateProps) {
  if (isLoading || !sessionStatus) {
    return <LoadingScreen />;
  }

  // Vault initialization routing is enforced at route-level in `routes/__root.tsx`.
  // SessionGate only guards locked sessions.
  if (!sessionStatus.vaultInitialized) {
    return children;
  }

  if (!sessionStatus.isUnlocked) {
    return <UnlockScreen onSubmit={unlock} />;
  }

  return children;
}
