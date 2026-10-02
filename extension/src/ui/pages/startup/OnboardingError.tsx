import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { OnboardingLayout } from "@/ui/components/OnboardingLayout";
import { Button } from "@/ui/components/ui/button";

export function OnboardingError() {
  const { t } = useTranslation();
  return (
    <OnboardingLayout>
      <div role="alert" className="flex w-full flex-col items-center gap-3 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <CircleAlert aria-hidden="true" className="size-5.5" />
        </div>
        <h1 className="mt-1 text-3xl leading-snug font-semibold">{t("startupFailed")}</h1>
        <p className="text-sm leading-normal font-medium text-muted-foreground">{t("startupFailedDescription")}</p>
      </div>
      <Button type="button" onClick={() => location.reload()} size="lg" className="w-full">
        {t("retry")}
      </Button>
    </OnboardingLayout>
  );
}
