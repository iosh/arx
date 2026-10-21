import { createFileRoute } from "@tanstack/react-router";
import { ImportPrivateKeyPage } from "@/ui/pages/onboarding/ImportPrivateKeyPage";

export const Route = createFileRoute("/onboarding/import-private-key")({ component: ImportPrivateKeyPage });
