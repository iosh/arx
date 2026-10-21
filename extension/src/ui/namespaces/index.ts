import type { Namespace } from "@arx/core/namespaces";
import { eip155Ui } from "./eip155";

export function getNamespaceUi(namespace: Namespace) {
  switch (namespace) {
    case "eip155":
      return eip155Ui;
    default:
      throw new Error(`Namespace "${namespace}" has no UI implementation.`);
  }
}
