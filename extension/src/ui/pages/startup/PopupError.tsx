import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/ui/button";

export function PopupError() {
  const { t } = useTranslation();
  return (
    <main className="flex h-full flex-col font-sans">
      <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 px-8 pb-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <CircleAlert aria-hidden="true" className="size-5.5" />
        </div>
        <h1 className="mt-1 text-lg font-semibold">{t("startupFailed")}</h1>
        <p className="text-xs leading-normal font-medium text-muted-foreground">{t("startupFailedDescription")}</p>
      </div>
      <footer className="px-3.5 pt-2 pb-3.5">
        <Button type="button" onClick={() => location.reload()} className="w-full">
          {t("retry")}
        </Button>
      </footer>
    </main>
  );
}
