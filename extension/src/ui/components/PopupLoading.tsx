import { useTranslation } from "react-i18next";
import { Spinner } from "@/ui/components/ui/spinner";

export function PopupLoading() {
  const { t } = useTranslation();
  return (
    <main className="flex h-full flex-col items-center gap-10 px-6 pt-35 pb-6 font-sans">
      <div className="text-3xl leading-tight font-bold text-brand">ARX</div>
      <Spinner aria-label={t("starting")} className="size-5 text-muted-foreground" />
    </main>
  );
}
