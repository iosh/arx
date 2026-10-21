import type { KeySourceId } from "@arx/core/keyring";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { MnemonicDisplay } from "./MnemonicDisplay";
import { MnemonicQuiz } from "./MnemonicQuiz";
import type { MnemonicWord } from "./mnemonic";

export function MnemonicBackup({
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
  const [step, setStep] = useState<"display" | "quiz">("display");
  const confirmBackup = useMutation({
    mutationFn: () => wallet.keySources.confirmMnemonicBackup({ keySourceId }),
  });

  function showMnemonic() {
    setStep("display");
  }

  if (step === "display") {
    return (
      <OnboardingStepLayout progress={{ current: totalSteps - 1, total: totalSteps }}>
        <MnemonicDisplay words={words} onContinue={() => setStep("quiz")} onDefer={onDefer} />
      </OnboardingStepLayout>
    );
  }

  return (
    <OnboardingStepLayout
      progress={{ current: totalSteps, total: totalSteps }}
      onBack={showMnemonic}
      backDisabled={confirmBackup.isPending}
    >
      <MnemonicQuiz
        words={words}
        onSubmit={() => confirmBackup.mutate(undefined, { onSuccess: onComplete })}
        onBack={showMnemonic}
        pending={confirmBackup.isPending}
      />
    </OnboardingStepLayout>
  );
}
