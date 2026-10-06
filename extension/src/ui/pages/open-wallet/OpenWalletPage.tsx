import { Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import browser from "webextension-polyfill";
import { OnboardingCard } from "@/ui/components/OnboardingCard";
import { OnboardingLayout } from "@/ui/components/OnboardingLayout";
import { Button } from "@/ui/components/ui/button";

export function OpenWalletPage() {
  const { t } = useTranslation("onboarding");

  return (
    <OnboardingLayout>
      <OnboardingCard title={t("walletReadyTitle")} description={t("openWalletDescription")}>
        <Button type="button" size="lg" className="w-full" onClick={async () => await browser.action.openPopup()}>
          <Wallet aria-hidden="true" />
          {t("openWallet")}
        </Button>
      </OnboardingCard>
    </OnboardingLayout>
  );
}
