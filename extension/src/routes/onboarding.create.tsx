import type { KeySourceId } from "@arx/core/keyring";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CreatePasswordForm } from "@/ui/components/CreatePasswordForm";
import type { MnemonicWord } from "@/ui/components/recovery-phrase/mnemonic";
import { RecoveryPhraseBackup } from "@/ui/components/recovery-phrase/RecoveryPhraseBackup";
import { useWallet } from "@/ui/wallet/WalletContext";

export const Route = createFileRoute("/onboarding/create")({
  component: CreateWallet,
});

type WalletCreationResult = { keySourceId: KeySourceId; words: readonly MnemonicWord[] };
const exitLocation = { to: "/onboarding", replace: true } as const;

function CreateWallet() {
  const { client: wallet } = useWallet();
  const { t } = useTranslation("wallet");
  const navigate = useNavigate();
  const [creation, setCreation] = useState<WalletCreationResult | null>(null);

  async function createWallet(password: string) {
    const { mnemonic } = await wallet.keySources.generateMnemonic();
    const { keySourceId } = await wallet.createFromMnemonic({
      password,
      mnemonic,
      name: t("defaultWalletName", { number: 1 }),
      namespace: "eip155",
    });
    setCreation({
      keySourceId,
      words: mnemonic.split(" ").map((word, index) => ({ position: index + 1, word })),
    });
  }

  function exit() {
    void navigate(exitLocation);
  }

  if (creation) {
    return (
      <RecoveryPhraseBackup
        keySourceId={creation.keySourceId}
        words={creation.words}
        totalSteps={3}
        onComplete={exit}
        onDefer={exit}
      />
    );
  }

  return <CreatePasswordForm totalSteps={3} onSubmit={createWallet} />;
}
