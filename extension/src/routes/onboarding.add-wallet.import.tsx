import { createFileRoute } from "@tanstack/react-router";
import { AddMnemonicWalletPage } from "@/ui/pages/onboarding/AddMnemonicWalletPage";

export const Route = createFileRoute("/onboarding/add-wallet/import")({
  component: () => <AddMnemonicWalletPage mode="import" />,
});
