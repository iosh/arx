import { eip155NamespaceManifest } from "../../namespaces/eip155/manifest.js";
import type { WalletNamespaceModule } from "../types.js";
import { createWalletNamespaceModuleFromManifest } from "./manifestInterop.js";

export const createEip155WalletNamespaceModule = (): WalletNamespaceModule => {
  return createWalletNamespaceModuleFromManifest(eip155NamespaceManifest);
};
