import { createFileRoute } from "@tanstack/react-router";
import { AddEvmNetworkPage } from "@/ui/pages/settings/AddEvmNetworkPage";

export const Route = createFileRoute("/wallet/settings/networks/add")({ component: AddEvmNetworkPage });
