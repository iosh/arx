import type { KeySourceId } from "@arx/core/keyring";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useWalletError } from "@/ui/wallet/useWalletError";
import { CreatePasswordForm } from "./CreatePasswordForm";
import { MnemonicBackup } from "./mnemonic/MnemonicBackup";
import type { MnemonicWord } from "./mnemonic/mnemonic";

type WalletCreationResult = { keySourceId: KeySourceId; words: readonly MnemonicWord[] };
const exitLocation = { to: "/onboarding", replace: true } as const;

export function CreateWalletPage() {
  const { client: wallet } = useWallet();
  const { t } = useTranslation("wallet");
  const showError = useWalletError();
  const navigate = useNavigate();
  const [creation, setCreation] = useState<WalletCreationResult | null>(null);

  async function createWallet(password: string) {
    try {
      const [{ mnemonic }, { selectedNamespace }] = await Promise.all([
        wallet.keySources.generateMnemonic(),
        wallet.networks.getSelection(),
      ]);
      const { keySourceId } = await wallet.createFromMnemonic({
        password,
        mnemonic,
        name: t("defaultWalletName", { number: 1 }),
        namespace: selectedNamespace,
      });
      setCreation({
        keySourceId,
        words: mnemonic.split(" ").map((word, index) => ({ position: index + 1, word })),
      });
    } catch (error) {
      showError(error);
    }
  }

  function exit() {
    void navigate(exitLocation);
  }

  if (creation) {
    return (
      <MnemonicBackup
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
