import "@/ui/styles/styles.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { i18n } from "@/ui/language/i18n";
import { UiLanguageProvider } from "@/ui/language/UiLanguageProvider";
import { queryClient } from "@/ui/queryClient";
import { connectWallet } from "@/ui/wallet/connectWallet";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("Onboarding root element is missing");

const walletConnectionPromise = connectWallet();

createRoot(container).render(
  <StrictMode>
    <UiLanguageProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <App connection={walletConnectionPromise} />
      </QueryClientProvider>
    </UiLanguageProvider>
  </StrictMode>,
);
