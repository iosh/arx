import { KeyringInvalidMnemonicError } from "@arx/core/keyring";
import { isWalletApiError } from "@arx/wallet-api/client";
import { Navigate, useBlocker } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useWalletError } from "@/ui/wallet/useWalletError";
import { useRestoreMnemonicWallet } from "@/ui/wallet/useWalletMutations";
import { CreatePasswordForm } from "./CreatePasswordForm";
import { MnemonicForm } from "./mnemonic/MnemonicForm";
import { type MnemonicFields, mnemonicDefaultValues, mnemonicFromFields } from "./mnemonic/mnemonic";

export function ImportMnemonicPage() {
  const [password, setPassword] = useState<string | null>(null);

  if (password === null) return <CreatePasswordForm totalSteps={2} onSubmit={setPassword} />;

  return <ImportMnemonicForm password={password} onBack={() => setPassword(null)} />;
}

function ImportMnemonicForm({ password, onBack }: { password: string; onBack(): void }) {
  const { status } = useWallet();
  const { t } = useTranslation(["onboarding", "wallet"]);
  const form = useForm<MnemonicFields>({ defaultValues: mnemonicDefaultValues });
  const { mutateAsync: restoreWallet, reset: resetRestore } = useRestoreMnemonicWallet();
  const reportError = useWalletError();
  const pending = form.formState.isSubmitting;

  useBlocker({ shouldBlockFn: () => pending, enableBeforeUnload: false });

  async function importWallet(fields: MnemonicFields) {
    await restoreWallet(
      { password, mnemonic: mnemonicFromFields(fields), name: t("wallet:defaultWalletName", { number: 1 }) },
      {
        onError: (error) => {
          if (isWalletApiError(error, KeyringInvalidMnemonicError)) form.setError("root.mnemonic", { type: "invalid" });
          else reportError(error);
        },
      },
    ).catch(() => undefined);
    resetRestore();
  }

  // Initialization is published before its response; wait for this form's submission to settle.
  if (status !== "uninitialized" && !pending) return <Navigate to="/onboarding" replace ignoreBlocker />;

  return <MnemonicForm form={form} progress={{ current: 2, total: 2 }} onSubmit={importWallet} onBack={onBack} />;
}
