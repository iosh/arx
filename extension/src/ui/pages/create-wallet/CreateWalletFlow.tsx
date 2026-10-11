import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { RecoveryPhraseBackup } from "@/ui/components/recovery-phrase/RecoveryPhraseBackup";
import { CreateWalletForm, type WalletCreationResult } from "./CreateWalletForm";

const exitLocation = { to: "/onboarding", replace: true } as const;

export function CreateWalletFlow() {
  const navigate = useNavigate();
  const [creation, setCreation] = useState<WalletCreationResult | null>(null);

  function exit() {
    void navigate(exitLocation);
  }

  if (creation) {
    return (
      <RecoveryPhraseBackup
        keySourceId={creation.keySourceId}
        words={creation.words}
        totalSteps={3}
        onComplete={exit}
        onDefer={exit}
      />
    );
  }

  return <CreateWalletForm onCreated={setCreation} />;
}
