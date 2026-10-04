import "@/ui/styles/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createUiI18n } from "@/ui/language/i18n";
import { readUiLanguage } from "@/ui/language/preferences";
import { UiLanguageProvider } from "@/ui/language/UiLanguageProvider";
import { connectWallet } from "@/ui/wallet/connectWallet";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("Popup root element is missing");

const walletConnectionPromise = connectWallet();
const i18n = createUiI18n(readUiLanguage());
const queryClient = new QueryClient();

createRoot(container).render(
  <StrictMode>
    <UiLanguageProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <App connection={walletConnectionPromise} />
      </QueryClientProvider>
    </UiLanguageProvider>
  </StrictMode>,
);
