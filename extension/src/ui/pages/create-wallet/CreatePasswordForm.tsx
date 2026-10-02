import { getVaultPasswordLength, VAULT_PASSWORD_MIN_LENGTH } from "@arx/core/wallet";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CardError } from "@/ui/components/CardError";
import { PasswordInput } from "@/ui/components/PasswordInput";
import { Button } from "@/ui/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/ui/components/ui/field";
import { Spinner } from "@/ui/components/ui/spinner";

export function CreatePasswordForm({
  onSubmit,
  pending,
  failed,
}: {
  onSubmit: (password: string) => Promise<void>;
  pending: boolean;
  failed: boolean;
}) {
  const { t } = useTranslation("onboarding");
  const id = useId();
  const passwordId = `${id}-password`;
  const confirmationId = `${id}-confirmation`;
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const passwordInput = useRef<HTMLInputElement>(null);
  const confirmationInput = useRef<HTMLInputElement>(null);
  const length = getVaultPasswordLength(password);
  const mismatch = confirmation.length > 0 && confirmation !== password;
  const canSubmit = length >= VAULT_PASSWORD_MIN_LENGTH && confirmation === password;

  useEffect(() => {
    passwordInput.current?.focus();
  }, []);

  const helper =
    length > 0 && length < VAULT_PASSWORD_MIN_LENGTH
      ? t("passwordRemaining", { count: VAULT_PASSWORD_MIN_LENGTH - length })
      : t("passwordMinimum", { count: VAULT_PASSWORD_MIN_LENGTH });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit && !pending) void onSubmit(password);
      }}
      className="flex w-full max-w-onboarding flex-col gap-6 rounded-xl bg-card p-8 text-card-foreground shadow-onboarding"
      aria-busy={pending}
    >
      <title>{t("passwordTitle")} · ARX</title>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl leading-snug font-semibold">{t("passwordTitle")}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{t("passwordDescription")}</p>
      </div>
      <div className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor={passwordId}>{t("password")}</FieldLabel>
          <PasswordInput
            id={passwordId}
            ref={passwordInput}
            fieldLabel={t("password")}
            placeholder={t("passwordPlaceholder")}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            disabled={pending}
            aria-describedby={`${passwordId}-description`}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                confirmationInput.current?.focus();
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
            id={confirmationId}
            ref={confirmationInput}
            fieldLabel={t("confirmPassword")}
            placeholder={t("confirmPasswordPlaceholder")}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
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
      <div className="flex flex-col gap-2.5">
        {failed && <CardError>{t("createFailed")}</CardError>}
        <Button
          type="submit"
          size="lg"
          className="w-full aria-busy:opacity-70"
          disabled={!canSubmit || pending}
          aria-busy={pending}
        >
          {pending && <Spinner aria-label={t("createWallet")} />}
          {t("continue")}
        </Button>
      </div>
    </form>
  );
}
