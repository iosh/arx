import { KeyringInvalidMnemonicError } from "@arx/core/keyring";
import { isWalletApiError } from "@arx/wallet-api/client";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { createFileRoute, Navigate, useBlocker } from "@tanstack/react-router";
import { type ClipboardEvent, useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { CardError } from "@/ui/components/CardError";
import { CreatePasswordForm } from "@/ui/components/CreatePasswordForm";
import { OnboardingCard } from "@/ui/components/OnboardingCard";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import { Button } from "@/ui/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/components/ui/input-group";
import { Spinner } from "@/ui/components/ui/spinner";
import { useWallet } from "@/ui/wallet/WalletContext";

export const Route = createFileRoute("/onboarding/import")({
  component: ImportRecoveryPhrase,
});

function ImportRecoveryPhrase() {
  const [password, setPassword] = useState<string | null>(null);

  return password === null ? (
    <CreatePasswordForm totalSteps={2} onSubmit={setPassword} />
  ) : (
    <RecoveryPhraseForm password={password} onBack={() => setPassword(null)} />
  );
}

type WordCount = 12 | 24;
type PhraseFields = { words: string[] };
const wordPositions = Array.from({ length: 24 }, (_, index) => index + 1);

function RecoveryPhraseForm({ password, onBack }: { password: string; onBack: () => void }) {
  const { client: wallet, status } = useWallet();
  const { t } = useTranslation(["onboarding", "wallet"]);
  const id = useId();
  const [wordCount, setWordCount] = useState<WordCount>(12);
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    formState: { errors, isSubmitting: pending },
  } = useForm<PhraseFields>({ defaultValues: { words: wordPositions.map(() => "") } });
  const words = useWatch({ control, name: "words" }).slice(0, wordCount);
  const canSubmit = words.every((word) => word.trim().length > 0);

  useBlocker({ shouldBlockFn: () => pending, enableBeforeUnload: false });

  function pastePhrase(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text/plain").trim().toLowerCase().split(/\s+/u);
    if (pasted.length < 2) return;
    event.preventDefault();

    if (pasted.length !== 12 && pasted.length !== 24) {
      setError("root.phrase", { type: "invalid" });
      return;
    }

    setWordCount(pasted.length);
    reset({ words: [...pasted, ...Array.from({ length: 24 - pasted.length }, () => "")] }, { keepDefaultValues: true });
  }

  async function importWallet({ words }: PhraseFields) {
    try {
      await wallet.restoreFromMnemonic({
        password,
        name: t("defaultWalletName", { ns: "wallet", number: 1 }),
        mnemonic: words
          .slice(0, wordCount)
          .map((word) => word.trim().toLowerCase())
          .join(" "),
        namespace: "eip155",
      });
    } catch (error) {
      if (isWalletApiError(error, KeyringInvalidMnemonicError)) {
        setError("root.phrase", { type: "invalid" });
        return;
      }
      throw error;
    }
  }

  // Navigate runs before useBlocker's effect updates; a settled status exit must bypass the old blocker.
  if (status !== "uninitialized" && !pending) return <Navigate to="/onboarding" replace ignoreBlocker />;

  return (
    <OnboardingStepLayout progress={{ current: 2, total: 2 }} onBack={onBack} backDisabled={pending}>
      <OnboardingCard asChild title={t("importRecoveryPhrase")} description={t("importPhraseInstructions")}>
        <form
          onSubmit={handleSubmit(importWallet)}
          onChange={() => clearErrors("root")}
          autoComplete="off"
          aria-busy={pending}
        >
          <fieldset
            aria-labelledby={`${id}-label`}
            aria-describedby={errors.root?.phrase ? `${id}-error` : undefined}
            className="flex min-w-0 flex-col gap-3"
          >
            <div className="flex items-center justify-between gap-3">
              <span id={`${id}-label`} className="text-sm font-medium">
                {t("recoveryPhrase")}
              </span>
              <RadioGroup.Root
                aria-label={t("importPhraseLength")}
                orientation="horizontal"
                value={String(wordCount)}
                onValueChange={(value) => {
                  setWordCount(Number(value) as WordCount);
                  clearErrors("root");
                }}
                disabled={pending}
                className="flex gap-0.5 rounded-md bg-background p-0.5"
              >
                {([12, 24] as const).map((count) => (
                  <RadioGroup.Item
                    key={count}
                    value={String(count)}
                    className="group flex h-6.25 items-center gap-0.75 rounded-sm px-2 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card data-[state=checked]:bg-card data-[state=checked]:text-foreground disabled:opacity-45"
                  >
                    <span className="group-data-[state=checked]:font-semibold">{count}</span>
                    {t("phraseWordUnit")}
                  </RadioGroup.Item>
                ))}
              </RadioGroup.Root>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {wordPositions.slice(0, wordCount).map((position) => (
                <InputGroup key={position} className="h-9.5">
                  <InputGroupAddon className="pl-2.5" aria-hidden="true">
                    <span className="w-4.5 text-right text-xs">{position}</span>
                  </InputGroupAddon>
                  <InputGroupInput
                    {...register(`words.${position - 1}`)}
                    aria-label={t("verifyWordPosition", { position })}
                    placeholder={t("importWordPlaceholder")}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    lang="en"
                    disabled={pending}
                    className="px-2.5 py-2 font-normal"
                    onPaste={pastePhrase}
                  />
                </InputGroup>
              ))}
            </div>
          </fieldset>
          {errors.root?.phrase && <CardError id={`${id}-error`}>{t("importPhraseIncorrect")}</CardError>}
          <Button
            type="submit"
            size="lg"
            className="w-full aria-busy:opacity-70"
            disabled={!canSubmit || pending}
            aria-busy={pending}
          >
            {pending && <Spinner aria-label={t("importWallet")} />}
            {t("importWallet")}
          </Button>
        </form>
      </OnboardingCard>
    </OnboardingStepLayout>
  );
}
