import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import browser from "webextension-polyfill";
import { Button } from "@/ui/components/ui/button";

async function openOnboarding() {
  await browser.tabs.create({ url: browser.runtime.getURL("onboarding.html") });
  window.close();
}

export function OnboardingLauncher() {
  const { t } = useTranslation("onboarding");
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void openOnboarding();
  }, []);

  return (
    <main className="flex h-full flex-col items-center gap-10 px-6 pt-35 pb-6 font-sans">
      <div className="text-3xl leading-tight font-bold text-brand">ARX</div>
      <Button type="button" className="w-full" onClick={openOnboarding}>
        {t("createWallet")}
      </Button>
    </main>
  );
}
