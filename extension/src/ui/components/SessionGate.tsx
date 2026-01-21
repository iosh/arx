import type { UiSnapshot } from "@arx/core/ui";
import type { ReactNode } from "react";
import { UnlockScreen } from "@/ui/screens/UnlockScreen";
import { LoadingScreen } from "./LoadingScreen";

type SessionGateProps = {
  snapshot?: UiSnapshot;
  isLoading: boolean;
  unlock: (password: string) => Promise<unknown>;
  children: ReactNode;
};

export function SessionGate({ snapshot, isLoading, unlock, children }: SessionGateProps) {
  if (isLoading || !snapshot) {
    return <LoadingScreen />;
  }

  // Vault initialization routing is enforced at route-level in `routes/__root.tsx`.
  // SessionGate only guards locked sessions.
  if (!snapshot.vault.initialized) {
    return children;
  }

  if (!snapshot.session.isUnlocked) {
    return <UnlockScreen onSubmit={unlock} />;
  }

  return children;
}
