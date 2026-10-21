import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "@/ui/pages/home/HomePage";

export const Route = createFileRoute("/wallet/")({ component: HomePage });
