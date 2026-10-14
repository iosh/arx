import { createFileRoute, Link } from "@tanstack/react-router";
import { Wallet } from "lucide-react";
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
        <section className="flex w-full max-w-onboarding flex-col gap-6 rounded-xl bg-card p-8 text-card-foreground shadow-onboarding">
          <h1 className="text-3xl leading-snug font-semibold">{t("welcomeTitle")}</h1>
          <Button asChild size="lg" className="w-full">
            <Link to="/onboarding/create">{t("createWallet")}</Link>
          </Button>
          <div className="flex flex-col gap-3">
            <h2 className="text-xs text-muted-foreground">{t("existingWallet")}</h2>
            <Button asChild variant="outline" size="lg" className="w-full">
              <Link to="/onboarding/import">{t("importRecoveryPhrase")}</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="w-full">
              <Link to="/onboarding/import-private-key">{t("importPrivateKey")}</Link>
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
