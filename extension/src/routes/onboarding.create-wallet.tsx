import { createFileRoute } from "@tanstack/react-router";
import { CreateWalletPage } from "@/ui/pages/onboarding/CreateWalletPage";

export const Route = createFileRoute("/onboarding/create-wallet")({ component: CreateWalletPage });
