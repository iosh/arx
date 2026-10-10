import { CircleAlert } from "lucide-react";
import { useEffect, useId } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { PasswordInput } from "@/ui/components/PasswordInput";
import { Button } from "@/ui/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/ui/components/ui/field";
import { Spinner } from "@/ui/components/ui/spinner";
import { useWallet } from "@/ui/wallet/WalletContext";

export function UnlockForm({ focusPassword = false }: { focusPassword?: boolean }) {
  const { client: wallet } = useWallet();
  const { t } = useTranslation("wallet");
  const id = useId();
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting: pending, isValid },
  } = useForm({ defaultValues: { password: "" }, mode: "onChange" });
  const incorrect = errors.password?.type === "incorrectPassword";

  useEffect(() => {
    if (focusPassword) setFocus("password");
  }, [focusPassword, setFocus]);

  async function unlock({ password }: { password: string }) {
    const unlocked = await wallet.unlock({ password });
    if (!unlocked) {
      setError("password", { type: "incorrectPassword" });
    }
  }

  return (
    <form className="flex w-full flex-col gap-4" aria-busy={pending} onSubmit={handleSubmit(unlock)}>
      <Field className="gap-2">
        <FieldLabel htmlFor={id} className="px-1 text-xs text-muted-foreground">
          {t("unlockPassword")}
        </FieldLabel>
        <PasswordInput
          {...register("password", { required: true })}
          id={id}
          fieldLabel={t("unlockPassword")}
          groupClassName="border-border bg-card [&_button]:size-7 [&_button]:rounded-md"
          autoComplete="current-password"
          disabled={pending}
          aria-invalid={incorrect}
          aria-describedby={incorrect ? `${id}-error` : undefined}
        />
        {incorrect && (
          <FieldDescription
            id={`${id}-error`}
            role="alert"
            className="flex items-center gap-1.5 px-1 text-destructive-foreground"
          >
            <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
            {t("incorrectPassword")}
          </FieldDescription>
        )}
      </Field>
      <Button type="submit" disabled={!isValid || pending} aria-busy={pending} className="w-full aria-busy:opacity-70">
        {pending && <Spinner aria-label={t("unlock")} />}
        {t("unlock")}
      </Button>
    </form>
  );
}
