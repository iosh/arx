import type { KeySourceId } from "@arx/core/keyring";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import type { MnemonicWord } from "@/ui/components/recovery-phrase/mnemonic";
import { RecoveryPhrase } from "@/ui/components/recovery-phrase/RecoveryPhrase";
import { VerifyRecoveryPhrase } from "@/ui/components/recovery-phrase/VerifyRecoveryPhrase";
import { useWallet } from "@/ui/wallet/WalletContext";

export function RecoveryPhraseBackup({
  keySourceId,
  words,
  totalSteps,
  onComplete,
  onDefer,
}: {
  keySourceId: KeySourceId;
  words: readonly MnemonicWord[];
  totalSteps: 2 | 3;
  onComplete: () => void;
  onDefer?: () => void;
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
      <OnboardingStepLayout progress={{ current: totalSteps - 1, total: totalSteps }}>
        <RecoveryPhrase words={words} onContinue={() => setStep("verify")} onDefer={onDefer} />
      </OnboardingStepLayout>
    );
  }

  return (
    <OnboardingStepLayout
      progress={{ current: totalSteps, total: totalSteps }}
      onBack={showPhrase}
      backDisabled={confirmBackup.isPending}
    >
      <VerifyRecoveryPhrase
        words={words}
        onSubmit={() => confirmBackup.mutate(undefined, { onSuccess: onComplete })}
        onBack={showPhrase}
        pending={confirmBackup.isPending}
      />
    </OnboardingStepLayout>
  );
}
