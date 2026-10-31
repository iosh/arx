import { type BackupStatus, type KeySourceId, KeySourceNotFoundError } from "@arx/core/keyring";
import { WalletLockedError } from "@arx/core/wallet";
import { isWalletApiError } from "@arx/wallet-api/client";
import { Navigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { OnboardingCard } from "@/ui/components/OnboardingCard";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import { PasswordInput } from "@/ui/components/PasswordInput";
import { Button } from "@/ui/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/ui/components/ui/field";
import { Spinner } from "@/ui/components/ui/spinner";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useConfirmMnemonicBackup } from "@/ui/wallet/keyring/useConfirmMnemonicBackup";
import { useMnemonicWallet } from "@/ui/wallet/keyring/useMnemonicSources";
import { MnemonicBackup } from "./mnemonic/MnemonicBackup";
import { MnemonicDisplay } from "./mnemonic/MnemonicDisplay";
import type { MnemonicWord } from "./mnemonic/mnemonic";

export function BackupMnemonicPage({ keySourceId }: { keySourceId: KeySourceId }) {
  const { status } = useWallet();
  const { t } = useTranslation(["onboarding", "wallet"]);
  const { data: mnemonicWallet, isPending: sourcePending } = useMnemonicWallet(keySourceId);

  if (status === "uninitialized") return <Navigate to="/onboarding" replace />;

  if (!mnemonicWallet) {
    return (
      <OnboardingStepLayout>
        <OnboardingCard title={t("viewPhraseTitle")} description={t("viewPhraseDescription")}>
          {sourcePending ? (
            <Spinner aria-label={t("wallet:loadingWallet")} />
          ) : (
            <p className="text-sm text-muted-foreground">{t("wallet:walletUnavailable")}</p>
          )}
        </OnboardingCard>
      </OnboardingStepLayout>
    );
  }

  return (
    <MnemonicWalletFlow
      keySourceId={keySourceId}
      walletName={mnemonicWallet.source.name}
      backupStatus={mnemonicWallet.source.backupStatus}
    />
  );
}

function MnemonicWalletFlow({
  keySourceId,
  walletName,
  backupStatus,
}: {
  keySourceId: KeySourceId;
  walletName: string;
  backupStatus: BackupStatus;
}) {
  const [words, setWords] = useState<readonly MnemonicWord[] | null>(null);
  const confirmBackup = useConfirmMnemonicBackup();

  function complete() {
    setWords(null);
    window.close();
  }

  if (!words) {
    return (
      <OnboardingStepLayout>
        <RevealMnemonicForm
          keySourceId={keySourceId}
          walletName={walletName}
          onReveal={(mnemonic) => setWords(mnemonic.split(" ").map((word, index) => ({ position: index + 1, word })))}
        />
      </OnboardingStepLayout>
    );
  }

  if (backupStatus === "confirmed") {
    return (
      <OnboardingStepLayout>
        <MnemonicDisplay
          mode="view"
          words={words}
          walletName={walletName}
          pending={confirmBackup.isPending}
          onContinue={complete}
        />
      </OnboardingStepLayout>
    );
  }

  return (
    <MnemonicBackup
      words={words}
      walletName={walletName}
      totalSteps={2}
      pending={confirmBackup.isPending}
      onComplete={() => confirmBackup.mutate(keySourceId, { onSuccess: complete })}
    />
  );
}

function RevealMnemonicForm({
  keySourceId,
  onReveal,
  walletName,
}: {
  keySourceId: KeySourceId;
  onReveal: (mnemonic: string) => void;
  walletName: string;
}) {
  const { client: wallet } = useWallet();
  const { t } = useTranslation("onboarding");
  const { t: walletText } = useTranslation("wallet");
  const id = useId();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: pending, isValid },
  } = useForm({ defaultValues: { password: "" }, mode: "onChange" });
  const incorrect = errors.password?.type === "incorrectPassword";

  async function submit({ password }: { password: string }) {
    try {
      const unlocked = await wallet.unlock({ password });
      if (!unlocked) {
        setError("password", { type: "incorrectPassword" });
        return;
      }

      const result = await wallet.keySources.exportMnemonic({ keySourceId, password });
      if (result === null) {
        setError("password", { type: "incorrectPassword" });
        return;
      }

      onReveal(result.mnemonic);
    } catch (error) {
      // The shared lock and source state determine the page after these refusals.
      if (isWalletApiError(error, WalletLockedError) || isWalletApiError(error, KeySourceNotFoundError)) return;
      throw error;
    }
  }

  return (
    <OnboardingCard asChild title={t("viewPhraseTitle")} description={t("viewPhraseDescription")}>
      <form aria-busy={pending} onSubmit={handleSubmit(submit)}>
        <p className="text-sm font-semibold wrap-anywhere">{walletName}</p>
        <Field>
          <FieldLabel htmlFor={id}>{walletText("unlockPassword")}</FieldLabel>
          <PasswordInput
            {...register("password", { required: true })}
            id={id}
            fieldLabel={walletText("unlockPassword")}
            placeholder={t("unlockPasswordPlaceholder")}
            autoComplete="current-password"
            disabled={pending}
            aria-invalid={incorrect}
            aria-describedby={`${id}-description`}
          />
          <FieldDescription id={`${id}-description`} aria-live="polite">
            {incorrect && <span className="text-destructive-foreground">{walletText("incorrectPassword")}</span>}
          </FieldDescription>
        </Field>
        <Button
          type="submit"
          size="lg"
          className="w-full aria-busy:opacity-70"
          disabled={!isValid || pending}
          aria-busy={pending}
        >
          {pending && <Spinner aria-label={t("continue")} />}
          {t("continue")}
        </Button>
      </form>
    </OnboardingCard>
  );
}
