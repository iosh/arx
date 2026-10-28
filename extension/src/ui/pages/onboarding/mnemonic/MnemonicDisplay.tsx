import { cn } from "cn";
import { Eye, EyeOff, TriangleAlert } from "lucide-react";
import { useId, useRef, useState } from "react";
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
import { Toaster } from "@/ui/components/ui/sonner";
import { Spinner } from "@/ui/components/ui/spinner";
import type { MnemonicWord } from "./mnemonic";

export function MnemonicDisplay({
  words,
  walletName,
  pending,
  onContinue,
  onDefer,
}: {
  words: readonly MnemonicWord[];
  walletName?: string;
  pending: boolean;
  onContinue: () => void;
  onDefer?: (returnFocusElement: HTMLButtonElement | null) => boolean | Promise<boolean>;
}) {
  const { t } = useTranslation("onboarding");
  const [visible, setVisible] = useState(false);
  const [hasRevealed, setHasRevealed] = useState(false);
  const hintId = useId();

  return (
    <OnboardingCard title={t("backupTitle")} description={t("backupDescription")}>
      {walletName && <p className="text-sm font-semibold wrap-anywhere">{walletName}</p>}
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
          disabled={pending}
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
        <Button type="button" size="lg" className="w-full" disabled={!hasRevealed || pending} onClick={onContinue}>
          {t("continue")}
        </Button>
        {onDefer && <DeferBackupDialog onConfirm={onDefer} onOpen={() => setVisible(false)} pending={pending} />}
      </div>
    </OnboardingCard>
  );
}

function DeferBackupDialog({
  onConfirm,
  onOpen,
  pending,
}: {
  onConfirm: (returnFocusElement: HTMLButtonElement | null) => boolean | Promise<boolean>;
  onOpen: () => void;
  pending: boolean;
}) {
  const { t } = useTranslation("onboarding");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (pending) return;
        if (nextOpen) onOpen();
        setOpen(nextOpen);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="sm"
          className="font-normal text-muted-foreground"
          disabled={pending}
        >
          {t("deferBackup")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent aria-busy={pending}>
        <div className="flex flex-col gap-2">
          <AlertDialogTitle>{t("deferBackupTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("deferBackupDescription")}</AlertDialogDescription>
        </div>
        <div className="flex flex-wrap justify-end gap-2.5">
          <AlertDialogAction asChild>
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-md font-medium"
              disabled={pending}
              onClick={async (event) => {
                event.preventDefault();
                const shouldClose = await onConfirm(triggerRef.current);
                if (shouldClose) setOpen(false);
              }}
            >
              {pending && <Spinner aria-label={t("enterWallet")} />}
              {t("enterWallet")}
            </Button>
          </AlertDialogAction>
          <AlertDialogCancel asChild>
            <Button type="button" className="h-10 rounded-md" disabled={pending}>
              {t("continueBackup")}
            </Button>
          </AlertDialogCancel>
        </div>
        <div className="absolute">
          <Toaster id="defer-backup" position="top-center" />
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
