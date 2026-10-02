import type { WalletStatus } from "@arx/core/wallet";
import { useEffect, useState } from "react";
import { OnboardingLayout } from "@/ui/components/OnboardingLayout";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import { useWalletClient } from "@/ui/wallet/WalletClientContext";
import { CreatePasswordForm } from "./CreatePasswordForm";

export function CreateWalletFlow({ status, onExit }: { status: WalletStatus; onExit: () => void }) {
  const wallet = useWalletClient();
  const [step, setStep] = useState<"password" | "creating" | "backup">("password");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // A submitted creation owns its next step, including when unlocked arrives before its response.
    if (step === "password" && status !== "uninitialized") onExit();
  }, [step, status, onExit]);

  async function createWallet(password: string) {
    if (step !== "password") return;
    setStep("creating");
    setFailed(false);
    try {
      const { mnemonic } = await wallet.keySources.generateMnemonic();
      await wallet.createFromMnemonic({ password, mnemonic, namespace: "eip155" });
      setStep("backup");
    } catch {
      setFailed(true);
      setStep("password");
    }
  }

  if (step === "backup") {
    return status === "unlocked" ? <OnboardingStepLayout currentStep={2} totalSteps={3} /> : <OnboardingLayout />;
  }

  return (
    <OnboardingStepLayout currentStep={1} totalSteps={3} onBack={onExit} backDisabled={step === "creating"}>
      <CreatePasswordForm onSubmit={createWallet} pending={step === "creating"} failed={failed} />
    </OnboardingStepLayout>
  );
}
