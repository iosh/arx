import { useTranslation } from "react-i18next";
import { Spinner } from "@/ui/components/ui/spinner";
import { OnboardingLayout } from "./OnboardingLayout";

export function OnboardingLoading() {
  const { t } = useTranslation();
  return (
    <OnboardingLayout>
      <Spinner aria-label={t("starting")} className="size-5 text-muted-foreground" />
    </OnboardingLayout>
  );
}
