import { type Network, parseChainRef } from "@arx/core/networks";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
import { Spinner } from "@/ui/components/ui/spinner";

export function NetworkDeleteDialog({
  network,
  description,
  open,
  onOpenChange,
  pending,
  onConfirm,
}: {
  network: Network;
  description: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  pending: boolean;
  onConfirm(): void;
}) {
  const { t } = useTranslation("wallet");

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (pending) return;
        if (nextOpen) toast.dismiss();
        onOpenChange(nextOpen);
      }}
    >
      <div className="shrink-0 overflow-hidden rounded-2xl bg-card py-1 text-card-foreground">
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="w-full justify-start px-4 text-destructive-foreground"
            disabled={pending}
          >
            {t("deleteNetwork")}
          </Button>
        </AlertDialogTrigger>
      </div>
      <AlertDialogContent aria-busy={pending}>
        <AlertDialogTitle className="wrap-anywhere">{t("deleteNetworkTitle", { name: network.name })}</AlertDialogTitle>
        <AlertDialogDescription className="wrap-anywhere">{description}</AlertDialogDescription>
        <p className="text-sm text-muted-foreground wrap-anywhere">
          Chain ID · {parseChainRef(network.chainRef).reference}
        </p>
        <div className="flex gap-3">
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" className="h-11 flex-1" disabled={pending}>
              {t("cancel")}
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              type="button"
              variant="destructive"
              className="h-11 flex-1"
              disabled={pending}
              aria-busy={pending}
              onClick={(event) => {
                event.preventDefault();
                onConfirm();
              }}
            >
              {pending && <Spinner aria-label={t("deletingNetwork")} />}
              {t("deleteNetwork")}
            </Button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
