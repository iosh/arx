import { ChevronRight, Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/ui/button";
import { LanguageMenu } from "@/ui/language/LanguageMenu";

export function WelcomePage({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation("onboarding");
  const createButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    createButton.current?.focus();
  }, []);

  return (
    <div className="flex min-h-dvh flex-col font-sans">
      <title>{t("welcomeTitle")} · ARX</title>
      <header className="flex h-16 shrink-0 items-center justify-between px-6 sm:px-10">
        <span className="text-xl leading-tight font-bold text-brand">ARX</span>
        <LanguageMenu />
      </header>
      <main className="flex flex-1 items-center justify-center px-6 pb-16 sm:px-10">
        <section className="flex min-h-120 w-full max-w-onboarding flex-col gap-6 rounded-xl bg-card p-8 text-card-foreground shadow-onboarding">
          <h1 className="text-3xl leading-snug font-semibold">{t("welcomeTitle")}</h1>
          <Button
            ref={createButton}
            type="button"
            variant="outline"
            className="h-18 w-full justify-start gap-3.5 bg-card px-4 text-left whitespace-normal shadow-none has-[>svg]:px-4"
            onClick={onCreate}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Plus aria-hidden="true" className="size-4.5" />
            </span>
            <span className="flex flex-1 flex-col gap-1">
              <span className="text-sm font-semibold">{t("createWallet")}</span>
              <span className="text-xs font-normal text-muted-foreground">{t("createWalletDescription")}</span>
            </span>
            <ChevronRight aria-hidden="true" className="size-4.5 text-placeholder" />
          </Button>
        </section>
      </main>
    </div>
  );
}
