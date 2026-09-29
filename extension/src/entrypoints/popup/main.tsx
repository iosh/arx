import "@/ui/styles/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Popup root element is missing");
}

createRoot(container).render(<StrictMode />);
