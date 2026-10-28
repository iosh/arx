import type { KeySourceId } from "@arx/core/keyring";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfirmMnemonicBackup } from "@/ui/wallet/keyring/useConfirmMnemonicBackup";
import { useCreateMnemonicWallet } from "@/ui/wallet/useWalletMutations";
import { CreatePasswordForm } from "./CreatePasswordForm";
import { MnemonicBackup } from "./mnemonic/MnemonicBackup";
import type { MnemonicWord } from "./mnemonic/mnemonic";

type WalletCreationResult = { keySourceId: KeySourceId; words: readonly MnemonicWord[] };
const exitLocation = { to: "/onboarding", replace: true } as const;

export function CreateWalletPage() {
  const navigate = useNavigate();
  const [creation, setCreation] = useState<WalletCreationResult | null>(null);
  const confirmBackup = useConfirmMnemonicBackup();

  function exit() {
    void navigate(exitLocation);
  }

  if (creation) {
    return (
      <MnemonicBackup
        words={creation.words}
        totalSteps={3}
        pending={confirmBackup.isPending}
        onComplete={() => confirmBackup.mutate(creation.keySourceId, { onSuccess: exit })}
        onDefer={() => {
          exit();
          return true;
        }}
      />
    );
  }

  return <CreateMnemonicWalletForm onCreated={setCreation} />;
}

function CreateMnemonicWalletForm({ onCreated }: { onCreated(result: WalletCreationResult): void }) {
  const { t } = useTranslation("wallet");
  const { mutateAsync: createWallet, reset: resetCreation } = useCreateMnemonicWallet();

  async function create(password: string) {
    const result = await createWallet({ password, name: t("defaultWalletName", { number: 1 }) }).catch(() => undefined);
    resetCreation();
    if (result?.status !== "initialized") return;

    onCreated({
      keySourceId: result.keySourceId,
      words: result.mnemonic.split(" ").map((word, index) => ({ position: index + 1, word })),
    });
  }

  return <CreatePasswordForm totalSteps={3} onSubmit={create} />;
}
