import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";

export function OnboardingStepLayout({
  children,
  currentStep,
  totalSteps,
  onBack,
  backDisabled,
}: Readonly<{
  children?: ReactNode;
  currentStep: number;
  totalSteps: number;
  onBack?: () => void;
  backDisabled?: boolean;
}>) {
  const { t } = useTranslation("onboarding");
  return (
    <div className="flex min-h-dvh flex-col font-sans">
      <header className="flex h-16 shrink-0 items-center px-6 sm:px-10">
        <div className="flex flex-1">
          {onBack && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded-md text-muted-foreground"
              onClick={onBack}
              disabled={backDisabled}
              aria-label={t("back")}
            >
              <ArrowLeft aria-hidden="true" className="size-5" />
            </Button>
          )}
        </div>
        <div
          role="progressbar"
          aria-label={t("progress", { current: currentStep, total: totalSteps })}
          aria-valuemin={1}
          aria-valuemax={totalSteps}
          aria-valuenow={currentStep}
          className="flex h-1 w-30 gap-1.5"
        >
          {Array.from({ length: totalSteps }, (_, index) => index + 1).map((step) => (
            <span key={step} className={`h-1 flex-1 rounded-full ${step <= currentStep ? "bg-brand" : "bg-border"}`} />
          ))}
        </div>
        <div className="flex-1" />
      </header>
      <main className="flex flex-1 items-start justify-center px-6 py-16 sm:px-10">{children}</main>
    </div>
  );
}
