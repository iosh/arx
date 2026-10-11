import type { KeySourceId } from "@arx/core/keyring";
import { useState } from "react";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import type { MnemonicWord } from "@/ui/components/recovery-phrase/mnemonic";
import { RecoveryPhraseBackup } from "@/ui/components/recovery-phrase/RecoveryPhraseBackup";
import { useWallet } from "@/ui/wallet/WalletContext";
import { VerifyPasswordForm } from "./VerifyPasswordForm";

export function BackupPage({ keySourceId, onComplete }: { keySourceId: KeySourceId; onComplete: () => void }) {
  const { client: wallet } = useWallet();
  const [words, setWords] = useState<readonly MnemonicWord[] | null>(null);

  async function readPhrase(password: string) {
    const unlocked = await wallet.unlock({ password });
    if (!unlocked) return false;

    const phrase = await wallet.keySources.exportMnemonic({ keySourceId, password });
    if (phrase === null) return false;

    setWords(phrase.mnemonic.split(" ").map((word, index) => ({ position: index + 1, word })));
    return true;
  }

  if (!words) {
    return (
      <OnboardingStepLayout>
        <VerifyPasswordForm onSubmit={readPhrase} />
      </OnboardingStepLayout>
    );
  }

  return <RecoveryPhraseBackup keySourceId={keySourceId} words={words} totalSteps={2} onComplete={onComplete} />;
}
