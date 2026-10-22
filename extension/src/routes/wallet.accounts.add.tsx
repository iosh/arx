import { createFileRoute } from "@tanstack/react-router";
import { AddAccountPage } from "@/ui/pages/accounts/AddAccountPage";

export const Route = createFileRoute("/wallet/accounts/add")({ component: AddAccountPage });
