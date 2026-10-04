import { WalletApiError } from "@arx/wallet-api/client";
import { CircleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PasswordInput } from "@/ui/components/PasswordInput";
import { Button } from "@/ui/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/ui/components/ui/field";
import { Spinner } from "@/ui/components/ui/spinner";
import { useWalletClient } from "@/ui/wallet/WalletClientContext";

export function UnlockForm({ focusPassword = false }: { focusPassword?: boolean }) {
  const wallet = useWalletClient();
  const { t } = useTranslation("wallet");
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [submission, setSubmission] = useState<"idle" | "pending" | "incorrect" | "failed">("idle");
  const pending = submission === "pending";
  const error =
    submission === "incorrect" ? t("incorrectPassword") : submission === "failed" ? t("unlockFailed") : null;

  useEffect(() => {
    if (focusPassword) input.current?.focus();
  }, [focusPassword]);

  async function unlock() {
    setSubmission("pending");
    try {
      await wallet.unlock({ password });
    } catch (cause) {
      setSubmission(
        cause instanceof WalletApiError && cause.code === "vault.incorrect_password" ? "incorrect" : "failed",
      );
      return;
    }
    setPassword("");
    setSubmission("idle");
  }

  return (
    <form
      className="flex w-full flex-col gap-4"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (password.length > 0 && !pending) void unlock();
      }}
    >
      <Field className="gap-2">
        <FieldLabel htmlFor={id} className="px-1 text-xs text-muted-foreground">
          {t("unlockPassword")}
        </FieldLabel>
        <PasswordInput
          id={id}
          ref={input}
          fieldLabel={t("unlockPassword")}
          groupClassName="border-border bg-card [&_button]:size-7 [&_button]:rounded-md"
          autoComplete="current-password"
          value={password}
          disabled={pending}
          aria-invalid={submission === "incorrect"}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            setPassword(event.target.value);
            setSubmission("idle");
          }}
        />
        {error && (
          <FieldDescription
            id={`${id}-error`}
            role="alert"
            className="flex items-center gap-1.5 px-1 text-destructive-foreground"
          >
            <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
            {error}
          </FieldDescription>
        )}
      </Field>
      <Button
        type="submit"
        disabled={password.length === 0 || pending}
        aria-busy={pending}
        className="w-full aria-busy:opacity-70"
      >
        {pending && <Spinner aria-label={t("unlock")} />}
        {t("unlock")}
      </Button>
    </form>
  );
}
