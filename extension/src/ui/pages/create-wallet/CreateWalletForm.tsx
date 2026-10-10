import type { KeySourceId } from "@arx/core/keyring";
import { getVaultPasswordLength, VAULT_PASSWORD_MIN_LENGTH } from "@arx/core/wallet";
import { Navigate, useBlocker, useNavigate } from "@tanstack/react-router";
import { useId } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { OnboardingCard } from "@/ui/components/OnboardingCard";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import { PasswordInput } from "@/ui/components/PasswordInput";
import type { MnemonicWord } from "@/ui/components/recovery-phrase/mnemonic";
import { Button } from "@/ui/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/ui/components/ui/field";
import { Spinner } from "@/ui/components/ui/spinner";
import { useWallet } from "@/ui/wallet/WalletContext";

export type CreatedWallet = { keySourceId: KeySourceId; words: readonly MnemonicWord[] };
const exitLocation = { to: "/onboarding", replace: true } as const;

export function CreateWalletForm({ onCreated }: { onCreated: (wallet: CreatedWallet) => void }) {
  const { client: wallet, status } = useWallet();
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

  async function createWallet({ password }: { password: string }) {
    const { mnemonic } = await wallet.keySources.generateMnemonic();
    const { keySourceId } = await wallet.createFromMnemonic({ password, mnemonic, namespace: "eip155" });
    onCreated({
      keySourceId,
      words: mnemonic.split(" ").map((word, index) => ({ position: index + 1, word })),
    });
  }

  const helper =
    length > 0 && length < VAULT_PASSWORD_MIN_LENGTH
      ? t("passwordRemaining", { count: VAULT_PASSWORD_MIN_LENGTH - length })
      : t("passwordMinimum", { count: VAULT_PASSWORD_MIN_LENGTH });

  // Initialization is published before the create response; let this submission finish.
  if (status !== "uninitialized" && !pending) return <Navigate {...exitLocation} />;

  return (
    <OnboardingStepLayout
      currentStep={1}
      totalSteps={3}
      onBack={() => void navigate(exitLocation)}
      backDisabled={pending}
    >
      <OnboardingCard asChild title={t("passwordTitle")} description={t("passwordDescription")}>
        <form onSubmit={handleSubmit(createWallet)} aria-busy={pending}>
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
            {pending && <Spinner aria-label={t("createWallet")} />}
            {t("continue")}
          </Button>
        </form>
      </OnboardingCard>
    </OnboardingStepLayout>
  );
}
