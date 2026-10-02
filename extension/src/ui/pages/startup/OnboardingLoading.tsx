import { useTranslation } from "react-i18next";
import { OnboardingLayout } from "@/ui/components/OnboardingLayout";
import { Spinner } from "@/ui/components/ui/spinner";

export function OnboardingLoading() {
  const { t } = useTranslation();
  return (
    <OnboardingLayout>
      <Spinner aria-label={t("starting")} className="size-5 text-muted-foreground" />
    </OnboardingLayout>
  );
}
