import { createFileRoute } from "@tanstack/react-router";
import { ImportMnemonicPage } from "@/ui/pages/onboarding/ImportMnemonicPage";

export const Route = createFileRoute("/onboarding/import-mnemonic")({ component: ImportMnemonicPage });
