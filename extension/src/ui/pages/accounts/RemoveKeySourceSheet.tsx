import { Check, X } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/ui/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/ui/components/ui/sheet";
import { Toaster } from "@/ui/components/ui/sonner";
import { Spinner } from "@/ui/components/ui/spinner";

export function RemoveKeySourceSheet({
  label,
  title,
  description,
  backupLabel,
  canRemove,
  isPending,
  onConfirm,
}: {
  label: string;
  title: string;
  description: string | undefined;
  backupLabel: string;
  canRemove: boolean | undefined;
  isPending: boolean;
  onConfirm(): void;
}) {
  const { t } = useTranslation(["wallet", "common"]);
  const [open, setOpen] = useState(false);
  const [backedUp, setBackedUp] = useState(false);
  const helpId = useId();

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(nextOpen) => {
          if (isPending) return;
          toast.dismiss();
          if (nextOpen) setBackedUp(false);
          setOpen(nextOpen);
        }}
      >
        <div className="shrink-0 overflow-hidden rounded-2xl bg-card py-1 text-card-foreground">
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="w-full justify-start px-4 text-destructive-foreground"
              disabled={canRemove !== true || isPending}
              aria-describedby={canRemove === false ? helpId : undefined}
            >
              {label}
            </Button>
          </SheetTrigger>
        </div>
        <SheetContent className="gap-4" aria-busy={isPending}>
          <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 pr-0.5 pl-1">
            <SheetTitle className="min-w-0 flex-1 wrap-anywhere">{title}</SheetTitle>
            <SheetClose asChild>
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                className="size-7.5 rounded-full text-muted-foreground"
                aria-label={t("common:close")}
                disabled={isPending}
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            </SheetClose>
          </div>
          <SheetDescription className="leading-relaxed wrap-anywhere">{description}</SheetDescription>
          {canRemove === false && (
            <p id={helpId} className="px-1 text-xs leading-relaxed text-muted-foreground" aria-live="polite">
              {t("lastAccountRemoval")}
            </p>
          )}
          <label className="flex items-start gap-2 px-1 text-sm font-medium wrap-anywhere">
            <span className="relative mt-0.5 flex size-4 shrink-0">
              <input
                type="checkbox"
                checked={backedUp}
                onChange={(event) => setBackedUp(event.target.checked)}
                disabled={isPending}
                className="peer size-4 appearance-none rounded border border-muted-foreground bg-card outline-none checked:border-foreground checked:bg-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-45"
              />
              <Check
                aria-hidden="true"
                className="pointer-events-none absolute inset-0.5 hidden size-3 text-card peer-checked:block"
              />
            </span>
            {backupLabel}
          </label>
          <Button
            type="button"
            variant="destructive"
            className="w-full"
            disabled={!backedUp || canRemove !== true || isPending}
            aria-busy={isPending}
            onClick={onConfirm}
          >
            {isPending && <Spinner aria-label={label} />}
            {label}
          </Button>
          <div className="absolute">
            <Toaster id="key-source-removal" position="top-center" />
          </div>
        </SheetContent>
      </Sheet>
      {canRemove === false && !open && (
        <p id={helpId} className="px-1.5 text-xs leading-relaxed text-muted-foreground">
          {t("lastAccountRemoval")}
        </p>
      )}
    </>
  );
}
