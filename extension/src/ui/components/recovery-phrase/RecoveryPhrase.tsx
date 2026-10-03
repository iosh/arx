import { cn } from "cn";
import { Eye, EyeOff, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingCard } from "@/ui/components/OnboardingCard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/ui/components/ui/alert-dialog";
import { Button } from "@/ui/components/ui/button";
import type { MnemonicWord } from "./mnemonic";

export function RecoveryPhrase({
  words,
  onContinue,
  onDefer,
}: {
  words: readonly MnemonicWord[];
  onContinue: () => void;
  onDefer?: () => void;
}) {
  const { t } = useTranslation("onboarding");
  const [visible, setVisible] = useState(false);
  const [hasRevealed, setHasRevealed] = useState(false);
  const hintId = useId();

  return (
    <OnboardingCard title={t("backupTitle")} description={t("backupDescription")}>
      <div className="relative rounded-md bg-background p-4 pt-12">
        <ol
          className={cn("grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-3", !visible && "blur-[5px]")}
          aria-hidden={!visible}
        >
          {words.map(({ position, word }) => (
            <li key={position} className="flex h-7.5 items-center gap-2.5">
              <span className="w-4.5 shrink-0 text-right text-xs text-muted-foreground">{position}</span>
              <span lang="en" className="text-base">
                {visible ? word : "••••••"}
              </span>
            </li>
          ))}
        </ol>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={
            visible
              ? "absolute top-2 right-2 size-7 rounded-md text-muted-foreground"
              : "absolute inset-0 h-full w-full flex-col gap-1.5 rounded-md bg-scrim p-4 hover:bg-scrim"
          }
          aria-label={visible ? t("hidePhrase") : t("showPhrase")}
          aria-describedby={visible ? undefined : hintId}
          onClick={() => {
            setVisible((current) => !current);
            setHasRevealed(true);
          }}
        >
          {visible ? (
            <EyeOff aria-hidden="true" className="size-4" />
          ) : (
            <>
              <span className="flex items-center gap-2 text-sm font-semibold text-brand">
                <Eye aria-hidden="true" className="size-4.5" />
                {t("showPhrase")}
              </span>
              <span id={hintId} className="text-xs font-normal text-muted-foreground">
                {t("showPhraseHint")}
              </span>
            </>
          )}
        </Button>
      </div>
      <div className="flex items-start gap-2.5 rounded-xl bg-warning-subtle p-3 text-sm leading-normal text-warning-foreground">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <p>{t("phraseWarning")}</p>
      </div>
      <div className="flex flex-col items-center gap-2.5">
        <Button type="button" size="lg" className="w-full" disabled={!hasRevealed} onClick={onContinue}>
          {t("continue")}
        </Button>
        {onDefer && <DeferBackupDialog onConfirm={onDefer} onOpen={() => setVisible(false)} />}
      </div>
    </OnboardingCard>
  );
}

function DeferBackupDialog({ onConfirm, onOpen }: { onConfirm: () => void; onOpen: () => void }) {
  const { t } = useTranslation("onboarding");

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (open) onOpen();
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="font-normal text-muted-foreground">
          {t("deferBackup")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <div className="flex flex-col gap-2">
          <AlertDialogTitle>{t("deferBackupTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("deferBackupDescription")}</AlertDialogDescription>
        </div>
        <div className="flex flex-wrap justify-end gap-2.5">
          <AlertDialogAction asChild>
            <Button type="button" variant="outline" className="h-10 rounded-md font-medium" onClick={onConfirm}>
              {t("enterWallet")}
            </Button>
          </AlertDialogAction>
          <AlertDialogCancel asChild>
            <Button type="button" className="h-10 rounded-md">
              {t("continueBackup")}
            </Button>
          </AlertDialogCancel>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
