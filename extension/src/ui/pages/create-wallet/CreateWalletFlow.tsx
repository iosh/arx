import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { type CreatedWallet, CreateWalletForm } from "./CreateWalletForm";
import { FirstBackupFlow } from "./FirstBackupFlow";

const exitLocation = { to: "/onboarding", replace: true } as const;

export function CreateWalletFlow() {
  const navigate = useNavigate();
  const [creation, setCreation] = useState<CreatedWallet | null>(null);

  function exit() {
    void navigate(exitLocation);
  }

  if (creation) {
    return <FirstBackupFlow keySourceId={creation.keySourceId} words={creation.words} onExit={exit} />;
  }

  return <CreateWalletForm onCreated={setCreation} />;
}
