import { createFileRoute } from "@tanstack/react-router";
import { ImportPrivateKeyPage } from "@/ui/pages/accounts/ImportPrivateKeyPage";

export const Route = createFileRoute("/wallet/accounts/import-private-key")({ component: ImportPrivateKeyPage });
