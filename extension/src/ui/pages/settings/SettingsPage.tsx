import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/ui/components/PageHeader";

export function SettingsPage() {
  const { t } = useTranslation("wallet");

  return (
    <main className="flex h-full flex-col font-sans">
      <title>{`${t("settings")} · ARX`}</title>
      <PageHeader title={t("settings")} backTo="/wallet" backLabel={t("backToWallet")} />
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pt-1 pb-3.5">
        <div aria-hidden="true" className="h-26 shrink-0" />
        <div className="shrink-0 overflow-hidden rounded-2xl bg-card py-1 text-card-foreground">
          <Link
            to="/wallet/settings/networks"
            className="flex h-12 items-center justify-between gap-2 px-4 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {t("networks")}
            <ChevronRight aria-hidden="true" className="size-3.75 shrink-0 text-placeholder" />
          </Link>
          <div aria-hidden="true" className="h-36" />
        </div>
      </div>
    </main>
  );
}
