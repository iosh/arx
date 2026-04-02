import { assertValidNamespaceManifest } from "../namespaces/validation.js";
import { createNamespaceManifestFromWalletNamespaceModule } from "./modules/manifestInterop.js";
import type { WalletNamespaceModule } from "./types.js";

export const assertValidWalletNamespaceModule = (module: WalletNamespaceModule): void => {
  if (module.engine.facts.namespace !== module.namespace) {
    throw new Error(
      `Wallet namespace module "${module.namespace}" must use engine.facts.namespace "${module.namespace}"; received "${module.engine.facts.namespace}"`,
    );
  }

  const factories = module.engine.factories;
  if (factories?.createApprovalBindings && !factories.createSigner) {
    throw new Error(
      `Wallet namespace module "${module.namespace}" factories.createApprovalBindings requires factories.createSigner`,
    );
  }

  if (factories?.createTransactionAdapter && !factories.createSigner) {
    throw new Error(
      `Wallet namespace module "${module.namespace}" factories.createTransactionAdapter requires factories.createSigner`,
    );
  }

  assertValidNamespaceManifest(createNamespaceManifestFromWalletNamespaceModule(module));
};
