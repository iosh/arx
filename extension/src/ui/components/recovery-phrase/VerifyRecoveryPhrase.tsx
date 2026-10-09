import * as RadioGroup from "@radix-ui/react-radio-group";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { CardError } from "@/ui/components/CardError";
import { OnboardingCard } from "@/ui/components/OnboardingCard";
import { Button } from "@/ui/components/ui/button";
import { Spinner } from "@/ui/components/ui/spinner";
import { buildMnemonicQuiz, type MnemonicWord } from "./mnemonic";

export function VerifyRecoveryPhrase({
  words,
  onSubmit,
  onBack,
  pending,
}: {
  words: readonly MnemonicWord[];
  onSubmit: () => void;
  onBack: () => void;
  pending: boolean;
}) {
  const { t } = useTranslation("onboarding");
  const id = useId();
  const [quiz] = useState(() => buildMnemonicQuiz(words));
  const [selected, setSelected] = useState<Partial<Record<number, string>>>({});
  const [incorrect, setIncorrect] = useState(false);
  const canSubmit = quiz.every(({ position }) => selected[position] !== undefined);

  return (
    <OnboardingCard asChild title={t("verifyPhraseTitle")} description={t("verifyPhraseDescription")}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit || pending) return;
          if (quiz.some(({ position, answer }) => selected[position] !== answer)) {
            setIncorrect(true);
            return;
          }
          setIncorrect(false);
          onSubmit();
        }}
        aria-busy={pending}
      >
        <div className="flex flex-col gap-4">
          {quiz.map(({ position, choices }) => (
            <div key={position} className="flex flex-col gap-1.5">
              <div id={`${id}-${position}`} className="text-xs text-muted-foreground">
                {t("verifyWordPosition", { position })}
              </div>
              <RadioGroup.Root
                className="grid grid-cols-3 gap-2"
                aria-labelledby={`${id}-${position}`}
                orientation="horizontal"
                value={selected[position] ?? ""}
                onValueChange={(word) => {
                  setSelected((current) => ({ ...current, [position]: word }));
                  setIncorrect(false);
                }}
                disabled={pending}
              >
                {choices.map((word) => (
                  <RadioGroup.Item
                    key={word}
                    asChild
                    value={word}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        // Route Enter through Radix so reselecting a word does not clear validation errors.
                        event.currentTarget.click();
                      }
                    }}
                  >
                    <Button
                      type="button"
                      variant="outline"
                      lang="en"
                      className="h-9 min-w-0 px-2 font-normal shadow-none focus-visible:ring-offset-card data-[state=checked]:border-brand data-[state=checked]:bg-brand-subtle data-[state=checked]:font-medium data-[state=checked]:text-brand-subtle-foreground data-[state=checked]:hover:bg-brand-subtle dark:bg-background dark:hover:bg-accent"
                    >
                      {word}
                    </Button>
                  </RadioGroup.Item>
                ))}
              </RadioGroup.Root>
            </div>
          ))}
        </div>
        {incorrect && <CardError>{t("verifyPhraseIncorrect")}</CardError>}
        <div className="flex flex-col gap-2.5">
          <Button
            type="submit"
            size="lg"
            className="w-full aria-busy:opacity-70"
            disabled={!canSubmit || pending}
            aria-busy={pending}
          >
            {pending && <Spinner aria-label={t("completeBackup")} />}
            {t("completeBackup")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="font-normal text-muted-foreground"
            onClick={onBack}
            disabled={pending}
          >
            {t("backToPhrase")}
          </Button>
        </div>
      </form>
    </OnboardingCard>
  );
}
