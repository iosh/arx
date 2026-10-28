import * as RadioGroup from "@radix-ui/react-radio-group";
import { type ClipboardEvent, useId } from "react";
import { type SubmitHandler, type UseFormReturn, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormErrorAlert } from "@/ui/components/FormErrorAlert";
import { OnboardingCard } from "@/ui/components/OnboardingCard";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import { Button } from "@/ui/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/components/ui/input-group";
import { Spinner } from "@/ui/components/ui/spinner";
import type { MnemonicFields } from "./mnemonic";

const wordPositions = Array.from({ length: 24 }, (_, index) => index + 1);

export function MnemonicForm({
  form,
  onSubmit,
  onBack,
  progress,
  disabled = false,
}: {
  form: UseFormReturn<MnemonicFields>;
  onSubmit: SubmitHandler<MnemonicFields>;
  onBack?: () => void;
  progress?: { current: number; total: number };
  disabled?: boolean;
}) {
  const { t } = useTranslation("onboarding");
  const id = useId();
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    setValue,
    formState: { errors, isSubmitting: pending },
  } = form;
  const wordCount = useWatch({ control, name: "wordCount" });
  const words = useWatch({ control, name: "words" }).slice(0, wordCount);
  const canSubmit = words.every((word) => word.trim().length > 0);
  const busy = pending || disabled;

  function pasteMnemonic(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text/plain").trim().toLowerCase().split(/\s+/u);
    if (pasted.length < 2) return;
    event.preventDefault();

    if (pasted.length !== 12 && pasted.length !== 24) {
      setError("root.mnemonic", { type: "invalid" });
      return;
    }

    reset(
      { wordCount: pasted.length, words: [...pasted, ...Array.from({ length: 24 - pasted.length }, () => "")] },
      { keepDefaultValues: true },
    );
  }

  return (
    <OnboardingStepLayout progress={progress} onBack={onBack} backDisabled={busy}>
      <OnboardingCard asChild title={t("importRecoveryPhrase")} description={t("importPhraseInstructions")}>
        <form
          onSubmit={handleSubmit(onSubmit)}
          onChange={() => clearErrors("root")}
          autoComplete="off"
          aria-busy={pending}
        >
          <fieldset
            aria-labelledby={`${id}-label`}
            aria-describedby={errors.root?.mnemonic ? `${id}-error` : undefined}
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
                  setValue("wordCount", Number(value) as MnemonicFields["wordCount"]);
                  clearErrors("root");
                }}
                disabled={busy}
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
                    disabled={busy}
                    className="px-2.5 py-2 font-normal"
                    onPaste={pasteMnemonic}
                  />
                </InputGroup>
              ))}
            </div>
          </fieldset>
          {errors.root?.mnemonic && (
            <FormErrorAlert id={`${id}-error`}>
              {errors.root.mnemonic.message ?? t("importPhraseIncorrect")}
            </FormErrorAlert>
          )}
          <Button
            type="submit"
            size="lg"
            className="w-full aria-busy:opacity-70"
            disabled={!canSubmit || busy}
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
