import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/ui/pages/settings/SettingsPage";

export const Route = createFileRoute("/wallet/settings/")({ component: SettingsPage });
