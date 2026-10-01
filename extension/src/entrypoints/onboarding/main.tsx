import "@/ui/styles/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createUiI18n } from "@/ui/language/i18n";
import { readUiLanguage } from "@/ui/language/preferences";
import { UiLanguageProvider } from "@/ui/language/UiLanguageProvider";
import { connectWallet } from "@/ui/wallet/connectWallet";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("Onboarding root element is missing");

const walletConnectionPromise = connectWallet();
const i18n = createUiI18n(readUiLanguage());

createRoot(container).render(
  <StrictMode>
    <UiLanguageProvider i18n={i18n}>
      <App connection={walletConnectionPromise} />
    </UiLanguageProvider>
  </StrictMode>,
);
