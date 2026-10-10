import { useId } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { OnboardingCard } from "@/ui/components/OnboardingCard";
import { PasswordInput } from "@/ui/components/PasswordInput";
import { Button } from "@/ui/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/ui/components/ui/field";
import { Spinner } from "@/ui/components/ui/spinner";

export function VerifyPasswordForm({ onSubmit }: { onSubmit: (password: string) => Promise<boolean> }) {
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
