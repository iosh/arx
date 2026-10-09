import type { KeySourceId } from "@arx/core/keyring";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import type { MnemonicWord } from "@/ui/components/recovery-phrase/mnemonic";
import { RecoveryPhrase } from "@/ui/components/recovery-phrase/RecoveryPhrase";
import { VerifyRecoveryPhrase } from "@/ui/components/recovery-phrase/VerifyRecoveryPhrase";
import { useWallet } from "@/ui/wallet/WalletContext";

export function FirstBackupFlow({
  keySourceId,
  words,
  onExit,
}: {
  keySourceId: KeySourceId;
  words: readonly MnemonicWord[];
  onExit: () => void;
}) {
  const { client: wallet } = useWallet();
  const [step, setStep] = useState<"phrase" | "verify">("phrase");
  const confirmBackup = useMutation({
    mutationFn: () => wallet.keySources.confirmMnemonicBackup({ keySourceId }),
  });

  function showPhrase() {
    setStep("phrase");
  }

  if (step === "phrase") {
    return (
      <OnboardingStepLayout currentStep={2} totalSteps={3}>
        <RecoveryPhrase words={words} onContinue={() => setStep("verify")} onDefer={onExit} />
      </OnboardingStepLayout>
    );
  }

  return (
    <OnboardingStepLayout currentStep={3} totalSteps={3} onBack={showPhrase} backDisabled={confirmBackup.isPending}>
      <VerifyRecoveryPhrase
        words={words}
        onSubmit={() => confirmBackup.mutate(undefined, { onSuccess: onExit })}
        onBack={showPhrase}
        pending={confirmBackup.isPending}
      />
    </OnboardingStepLayout>
  );
}
