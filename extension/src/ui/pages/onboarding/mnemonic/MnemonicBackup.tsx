import { useState } from "react";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import { MnemonicDisplay } from "./MnemonicDisplay";
import { MnemonicQuiz } from "./MnemonicQuiz";
import type { MnemonicWord } from "./mnemonic";

export function MnemonicBackup({
  words,
  totalSteps,
  pending,
  onComplete,
  onDefer,
}: {
  words: readonly MnemonicWord[];
  totalSteps: 2 | 3;
  pending: boolean;
  onComplete: () => void;
  onDefer?: () => void;
}) {
  const [step, setStep] = useState<"display" | "quiz">("display");

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
      backDisabled={pending}
    >
      <MnemonicQuiz words={words} onSubmit={onComplete} onBack={showMnemonic} pending={pending} />
    </OnboardingStepLayout>
  );
}
