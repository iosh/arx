import type { KeySourceId } from "@arx/core/keyring";
import { Navigate, useBlocker, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import type { MnemonicWord } from "@/ui/components/recovery-phrase/mnemonic";
import { useWallet } from "@/ui/wallet/WalletContext";
import { CreatePasswordForm } from "./CreatePasswordForm";
import { FirstBackupFlow } from "./FirstBackupFlow";

type CreationState =
  | { status: "idle" | "pending" | "failed" }
  | { status: "created"; keySourceId: KeySourceId; words: readonly MnemonicWord[] };

const exitLocation = { to: "/onboarding", replace: true } as const;

export function CreateWalletFlow() {
  const { client: wallet, status } = useWallet();
  const navigate = useNavigate();
  const [creation, setCreation] = useState<CreationState>({ status: "idle" });
  const pending = creation.status === "pending";

  useBlocker({ shouldBlockFn: () => pending, enableBeforeUnload: false });

  function exit() {
    void navigate(exitLocation);
  }

  async function createWallet(password: string) {
    setCreation({ status: "pending" });
    try {
      const { mnemonic } = await wallet.keySources.generateMnemonic();
      const { keySourceId } = await wallet.createFromMnemonic({ password, mnemonic, namespace: "eip155" });
      setCreation({
        status: "created",
        keySourceId,
        words: mnemonic.split(" ").map((word, index) => ({ position: index + 1, word })),
      });
    } catch {
      setCreation({ status: "failed" });
    }
  }

  if (creation.status === "created") {
    return <FirstBackupFlow keySourceId={creation.keySourceId} words={creation.words} onExit={exit} />;
  }

  // Initialization is published before the create response; let this submission finish.
  if (status !== "uninitialized" && !pending) return <Navigate {...exitLocation} />;

  return (
    <OnboardingStepLayout currentStep={1} totalSteps={3} onBack={exit} backDisabled={pending}>
      <CreatePasswordForm onSubmit={createWallet} pending={pending} failed={creation.status === "failed"} />
    </OnboardingStepLayout>
  );
}
