import type { KeySourceId } from "@arx/core/keyring";
import { useState } from "react";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import type { MnemonicWord } from "@/ui/components/recovery-phrase/mnemonic";
import { RecoveryPhrase } from "@/ui/components/recovery-phrase/RecoveryPhrase";
import { VerifyRecoveryPhrase } from "@/ui/components/recovery-phrase/VerifyRecoveryPhrase";
import { useWalletClient } from "@/ui/wallet/WalletClientContext";

type BackupStep = { page: "phrase" } | { page: "verify"; submission: "idle" | "pending" | "failed" };

export function FirstBackupFlow({
  keySourceId,
  words,
  onExit,
}: {
  keySourceId: KeySourceId;
  words: readonly MnemonicWord[];
  onExit: () => void;
}) {
  const wallet = useWalletClient();
  const [step, setStep] = useState<BackupStep>({ page: "phrase" });

  function showPhrase() {
    setStep({ page: "phrase" });
  }

  async function confirmBackup() {
    setStep({ page: "verify", submission: "pending" });
    try {
      await wallet.keySources.confirmMnemonicBackup({ keySourceId });
    } catch {
      setStep({ page: "verify", submission: "failed" });
      return;
    }
    onExit();
  }

  if (step.page === "phrase") {
    return (
      <OnboardingStepLayout currentStep={2} totalSteps={3}>
        <RecoveryPhrase
          words={words}
          onContinue={() => setStep({ page: "verify", submission: "idle" })}
          onDefer={onExit}
        />
      </OnboardingStepLayout>
    );
  }

  const pending = step.submission === "pending";
  return (
    <OnboardingStepLayout currentStep={3} totalSteps={3} onBack={showPhrase} backDisabled={pending}>
      <VerifyRecoveryPhrase
        words={words}
        onSubmit={confirmBackup}
        onBack={showPhrase}
        pending={pending}
        failed={step.submission === "failed"}
      />
    </OnboardingStepLayout>
  );
}
