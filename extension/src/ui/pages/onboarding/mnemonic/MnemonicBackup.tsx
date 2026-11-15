import { useState } from "react";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import { MnemonicDisplay } from "./MnemonicDisplay";
import { MnemonicQuiz } from "./MnemonicQuiz";
import type { MnemonicWord } from "./mnemonic";

export function MnemonicBackup({
  words,
  walletName,
  totalSteps,
  pending,
  loading = false,
  submitDisabled = false,
  onComplete,
  onDefer,
}: {
  words: readonly MnemonicWord[] | undefined;
  walletName?: string;
  totalSteps: 2 | 3;
  pending: boolean;
  loading?: boolean;
  submitDisabled?: boolean;
  onComplete: () => void;
  onDefer?: (returnFocusElement: HTMLButtonElement | null) => boolean | Promise<boolean>;
}) {
  const [step, setStep] = useState<"display" | "quiz">("display");

  function showMnemonic() {
    setStep("display");
  }

  if (step === "display" || !words) {
    return (
      <OnboardingStepLayout progress={{ current: totalSteps - 1, total: totalSteps }}>
        <MnemonicDisplay
          words={words}
          walletName={walletName}
          pending={pending}
          loading={loading}
          onContinue={() => setStep("quiz")}
          deferDisabled={submitDisabled}
          onDefer={onDefer}
        />
      </OnboardingStepLayout>
    );
  }

  return (
    <OnboardingStepLayout
      progress={{ current: totalSteps, total: totalSteps }}
      onBack={showMnemonic}
      backDisabled={pending}
    >
      <MnemonicQuiz
        words={words}
        walletName={walletName}
        onSubmit={onComplete}
        onBack={showMnemonic}
        pending={pending}
        loading={loading}
        submitDisabled={submitDisabled}
      />
    </OnboardingStepLayout>
  );
}
