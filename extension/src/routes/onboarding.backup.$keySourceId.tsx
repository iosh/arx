import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { OnboardingCard } from "@/ui/components/OnboardingCard";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import { PasswordInput } from "@/ui/components/PasswordInput";
import type { MnemonicWord } from "@/ui/components/recovery-phrase/mnemonic";
import { RecoveryPhraseBackup } from "@/ui/components/recovery-phrase/RecoveryPhraseBackup";
import { Button } from "@/ui/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/ui/components/ui/field";
import { Spinner } from "@/ui/components/ui/spinner";
import { useWallet } from "@/ui/wallet/WalletContext";

export const Route = createFileRoute("/onboarding/backup/$keySourceId")({
  component: Backup,
  remountDeps: ({ params }) => params.keySourceId,
});

function Backup() {
  const { client: wallet, status } = useWallet();
  const { keySourceId } = Route.useParams();
  const navigate = Route.useNavigate();
  const [words, setWords] = useState<readonly MnemonicWord[] | null>(null);

  async function readPhrase(password: string) {
    const unlocked = await wallet.unlock({ password });
    if (!unlocked) return false;

    const phrase = await wallet.keySources.exportMnemonic({ keySourceId, password });
    if (phrase === null) return false;

    setWords(phrase.mnemonic.split(" ").map((word, index) => ({ position: index + 1, word })));
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
        <VerifyPasswordForm onSubmit={readPhrase} />
      </OnboardingStepLayout>
    );
  }

  return <RecoveryPhraseBackup keySourceId={keySourceId} words={words} totalSteps={2} onComplete={complete} />;
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
