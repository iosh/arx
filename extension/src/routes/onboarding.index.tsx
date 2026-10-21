import { createFileRoute } from "@tanstack/react-router";
import { OnboardingPage } from "@/ui/pages/onboarding/OnboardingPage";

export const Route = createFileRoute("/onboarding/")({ component: OnboardingPage });
