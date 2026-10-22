import { createFileRoute } from "@tanstack/react-router";
import { AccountsPage } from "@/ui/pages/accounts/AccountsPage";

export const Route = createFileRoute("/wallet/accounts/")({ component: AccountsPage });
