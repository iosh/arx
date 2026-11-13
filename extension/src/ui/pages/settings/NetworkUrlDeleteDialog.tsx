import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/ui/components/ui/alert-dialog";
import { Button } from "@/ui/components/ui/button";
import { Toaster } from "@/ui/components/ui/sonner";
import { Spinner } from "@/ui/components/ui/spinner";

export function NetworkUrlDeleteDialog({
  title,
  url,
  pending,
  toasterId,
  onClose,
  onConfirm,
  onCloseAutoFocus,
}: {
  title: string;
  url: string;
  pending: boolean;
  toasterId: string;
  onClose(): void;
  onConfirm(): void;
  onCloseAutoFocus(event: Event): void;
}) {
  const { t } = useTranslation("wallet");
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription dir="ltr" className="wrap-anywhere">
          {url}
        </AlertDialogDescription>
        <div className="flex gap-2">
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" className="h-10 flex-1" disabled={pending}>
              {t("cancel")}
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              type="button"
              variant="destructive"
              className="h-10 flex-1"
              disabled={pending}
              aria-busy={pending}
              onClick={(event) => {
                event.preventDefault();
                onConfirm();
              }}
            >
              {pending && <Spinner aria-label={t("savingNetwork")} />}
              {t("delete")}
            </Button>
          </AlertDialogAction>
        </div>
        <div className="absolute">
          <Toaster id={toasterId} position="top-center" />
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
