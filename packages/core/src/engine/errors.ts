import { ArxBaseError } from "../errors.js";

export class NamespaceDefinitionRequiredError extends ArxBaseError {
  static readonly code = "namespace.definition_required";

  constructor() {
    super("At least one namespace definition is required.", {
      code: NamespaceDefinitionRequiredError.code,
    });
  }
}
