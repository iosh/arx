import { createFileRoute } from "@tanstack/react-router";
import { NetworksPage } from "@/ui/pages/settings/NetworksPage";

export const Route = createFileRoute("/wallet/settings/networks/")({ component: NetworksPage });
