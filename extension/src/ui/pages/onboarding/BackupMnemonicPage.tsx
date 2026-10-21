import type { KeySourceId } from "@arx/core/keyring";
import { Navigate, useNavigate } from "@tanstack/react-router";
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
import { MnemonicBackup } from "./mnemonic/MnemonicBackup";
import type { MnemonicWord } from "./mnemonic/mnemonic";

export function BackupMnemonicPage({ keySourceId }: { keySourceId: KeySourceId }) {
  const { client: wallet, status } = useWallet();
  const navigate = useNavigate();
  const [words, setWords] = useState<readonly MnemonicWord[] | null>(null);

  async function readMnemonic(password: string) {
    const unlocked = await wallet.unlock({ password });
    if (!unlocked) return false;

    const result = await wallet.keySources.exportMnemonic({ keySourceId, password });
    if (result === null) return false;

    setWords(result.mnemonic.split(" ").map((word, index) => ({ position: index + 1, word })));
    return true;
  }

  function complete() {
    void navigate({ to: "/onboarding", replace: true });
    window.close();
  }

  if (status === "uninitialized") return <Navigate to="/onboarding" replace />;

  if (!words) {
    return (
      <OnboardingStepLayout>
        <VerifyPasswordForm onSubmit={readMnemonic} />
      </OnboardingStepLayout>
    );
  }

  return <MnemonicBackup keySourceId={keySourceId} words={words} totalSteps={2} onComplete={complete} />;
}

function VerifyPasswordForm({
  onSubmit,
}: {
  /** Returns false only when the password does not match. */
  onSubmit: (password: string) => Promise<boolean>;
}) {
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
    const verified = await onSubmit(password);
    if (!verified) {
      setError("password", { type: "incorrectPassword" });
    }
  }

  return (
    <OnboardingCard asChild title={t("viewPhraseTitle")} description={t("viewPhraseDescription")}>
      <form aria-busy={pending} onSubmit={handleSubmit(submit)}>
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
