import type { UiMethodResult } from "@arx/core/ui";
import type { ReactNode } from "react";
import { UnlockScreen } from "@/ui/screens/UnlockScreen";
import { LoadingScreen } from "./LoadingScreen";

type SessionGateProps = {
  sessionStatus?: UiMethodResult<"ui.session.getStatus">;
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
