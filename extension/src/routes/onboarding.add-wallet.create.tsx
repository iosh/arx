import { createFileRoute } from "@tanstack/react-router";
import { AddMnemonicWalletPage } from "@/ui/pages/onboarding/AddMnemonicWalletPage";

export const Route = createFileRoute("/onboarding/add-wallet/create")({
  component: () => <AddMnemonicWalletPage mode="create" />,
});
