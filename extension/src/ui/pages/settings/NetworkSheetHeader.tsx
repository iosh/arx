import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/ui/button";
import { SheetClose, SheetTitle } from "@/ui/components/ui/sheet";

export function NetworkSheetHeader({ title, pending }: { title: string; pending: boolean }) {
  const { t } = useTranslation("common");
  return (
    <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 pr-0.5 pl-1">
      <SheetTitle className="min-w-0 flex-1 wrap-anywhere">{title}</SheetTitle>
      <SheetClose asChild>
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          className="size-7.5 shrink-0 rounded-full text-muted-foreground"
          aria-label={t("close")}
          disabled={pending}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </SheetClose>
    </div>
  );
}
