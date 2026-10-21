import { getVaultPasswordLength, VAULT_PASSWORD_MIN_LENGTH } from "@arx/core/wallet";
import { Navigate, useBlocker, useNavigate } from "@tanstack/react-router";
import { useId } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { OnboardingCard } from "@/ui/components/OnboardingCard";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import { PasswordInput } from "@/ui/components/PasswordInput";
import { Button } from "@/ui/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/ui/components/ui/field";
import { Spinner } from "@/ui/components/ui/spinner";
import { useWallet } from "@/ui/wallet/connection/WalletContext";

const exitLocation = { to: "/onboarding", replace: true } as const;

export function CreatePasswordForm({
  totalSteps,
  onSubmit,
}: {
  totalSteps: number;
  onSubmit: (password: string) => void | Promise<void>;
}) {
  const { status } = useWallet();
  const navigate = useNavigate();
  const { t } = useTranslation("onboarding");
  const id = useId();
  const passwordId = `${id}-password`;
  const confirmationId = `${id}-confirmation`;
  const {
    register,
    control,
    handleSubmit,
    setFocus,
    formState: { errors, isSubmitting: pending, isValid },
  } = useForm({ defaultValues: { password: "", confirmation: "" }, mode: "onChange" });
  const password = useWatch({ control, name: "password" });
  const length = getVaultPasswordLength(password);
  const mismatch = errors.confirmation?.type === "validate";

  useBlocker({ shouldBlockFn: () => pending, enableBeforeUnload: false });

  const helper =
    length > 0 && length < VAULT_PASSWORD_MIN_LENGTH
      ? t("passwordRemaining", { count: VAULT_PASSWORD_MIN_LENGTH - length })
      : t("passwordMinimum", { count: VAULT_PASSWORD_MIN_LENGTH });

  // Initialization is published before the command response; let this submission finish.
  // Navigate runs before the previous render's blocker effect is removed.
  if (status !== "uninitialized" && !pending) return <Navigate {...exitLocation} ignoreBlocker />;

  return (
    <OnboardingStepLayout
      progress={{ current: 1, total: totalSteps }}
      onBack={() => void navigate(exitLocation)}
      backDisabled={pending}
    >
      <OnboardingCard asChild title={t("passwordTitle")} description={t("passwordDescription")}>
        <form onSubmit={handleSubmit(({ password }) => onSubmit(password))} aria-busy={pending}>
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor={passwordId}>{t("password")}</FieldLabel>
              <PasswordInput
                {...register("password", {
                  validate: (value) => getVaultPasswordLength(value) >= VAULT_PASSWORD_MIN_LENGTH,
                  deps: ["confirmation"],
                })}
                id={passwordId}
                fieldLabel={t("password")}
                placeholder={t("passwordPlaceholder")}
                autoComplete="new-password"
                disabled={pending}
                aria-describedby={`${passwordId}-description`}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    setFocus("confirmation");
                  }
                }}
              />
              <FieldDescription id={`${passwordId}-description`} aria-live="polite">
                {helper}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={confirmationId}>{t("confirmPassword")}</FieldLabel>
              <PasswordInput
                {...register("confirmation", {
                  required: true,
                  validate: (value, values) => value === values.password,
                })}
                id={confirmationId}
                fieldLabel={t("confirmPassword")}
                placeholder={t("confirmPasswordPlaceholder")}
                autoComplete="new-password"
                disabled={pending}
                aria-invalid={mismatch}
                aria-describedby={`${confirmationId}-description`}
              />
              <FieldDescription id={`${confirmationId}-description`} aria-live="polite">
                {mismatch && <span className="text-destructive-foreground">{t("passwordMismatch")}</span>}
              </FieldDescription>
            </Field>
          </div>
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
    </OnboardingStepLayout>
  );
}
