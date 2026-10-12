import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, FileKey, Plus, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import browser from "webextension-polyfill";
import { OnboardingCard } from "@/ui/components/OnboardingCard";
import { OnboardingLayout } from "@/ui/components/OnboardingLayout";
import { Button } from "@/ui/components/ui/button";
import { LanguageMenu } from "@/ui/language/LanguageMenu";
import { useWallet } from "@/ui/wallet/WalletContext";

export const Route = createFileRoute("/onboarding/")({
  component: Onboarding,
});

function Onboarding() {
  const { status } = useWallet();
  return status === "uninitialized" ? <Welcome /> : <OpenWallet />;
}

function Welcome() {
  const { t } = useTranslation("onboarding");

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
            asChild
            variant="outline"
            className="h-18 w-full justify-start gap-3.5 bg-card px-4 text-left whitespace-normal shadow-none has-[>svg]:px-4"
          >
            <Link to="/onboarding/create">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Plus aria-hidden="true" className="size-4.5" />
              </span>
              <span className="flex flex-1 flex-col gap-1">
                <span className="text-sm font-semibold">{t("createWallet")}</span>
                <span className="text-xs font-normal text-muted-foreground">{t("createWalletDescription")}</span>
              </span>
              <ChevronRight aria-hidden="true" className="size-4.5 text-placeholder" />
            </Link>
          </Button>
          <div className="flex flex-col gap-3">
            <h2 className="text-xs text-muted-foreground">{t("existingWallet")}</h2>
            <Button
              asChild
              variant="outline"
              className="h-18 w-full justify-start gap-3.5 bg-card px-4 text-left whitespace-normal shadow-none has-[>svg]:px-4"
            >
              <Link to="/onboarding/import">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                  <FileKey aria-hidden="true" className="size-4.5" />
                </span>
                <span className="flex flex-1 flex-col gap-1">
                  <span className="text-sm font-semibold">{t("importRecoveryPhrase")}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {t("importRecoveryPhraseDescription")}
                  </span>
                </span>
                <ChevronRight aria-hidden="true" className="size-4.5 text-placeholder" />
              </Link>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}

function OpenWallet() {
  const { t } = useTranslation("onboarding");

  return (
    <OnboardingLayout>
      <OnboardingCard title={t("walletReadyTitle")} description={t("openWalletDescription")}>
        <Button type="button" size="lg" className="w-full" onClick={() => browser.action.openPopup()}>
          <Wallet aria-hidden="true" />
          {t("openWallet")}
        </Button>
      </OnboardingCard>
    </OnboardingLayout>
  );
}
