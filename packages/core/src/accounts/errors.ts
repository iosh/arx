import { ArxBaseError } from "../errors.js";
import type { KeySourceId } from "../keyring/types.js";
import type { Namespace } from "../namespaces/types.js";
import type { AccountGroupId } from "./accountGroupId.js";
import type { AccountId } from "./accountId.js";

export class AccountGroupNotFoundError extends ArxBaseError {
  static readonly code = "account.group_not_found";

  constructor(accountGroupId: AccountGroupId) {
    super(`Account group "${accountGroupId}" was not found.`, {
      code: AccountGroupNotFoundError.code,
      details: { accountGroupId },
    });
  }
}

export class AccountAlreadyExistsError extends ArxBaseError {
  static readonly code = "account.already_exists";

  constructor(accountId: AccountId) {
    super(`Account "${accountId}" already exists.`, {
      code: AccountAlreadyExistsError.code,
      details: { accountId },
    });
  }
}

export class AccountNotFoundError extends ArxBaseError {
  static readonly code = "account.not_found";

  constructor(accountId: AccountId) {
    super(`Account "${accountId}" was not found.`, {
      code: AccountNotFoundError.code,
      details: { accountId },
    });
  }
}

export class AccountNamespaceUnsupportedError extends ArxBaseError {
  static readonly code = "account.namespace_unsupported";

  constructor(namespace: Namespace) {
    super(`Accounts are not supported for namespace "${namespace}".`, {
      code: AccountNamespaceUnsupportedError.code,
      details: { namespace },
    });
  }
}

export class AccountNamespaceMismatchError extends ArxBaseError {
  static readonly code = "account.namespace_mismatch";

  constructor(input: { accountId: AccountId; accountNamespace: Namespace; expectedNamespace: Namespace }) {
    super(`Account "${input.accountId}" does not belong to namespace "${input.expectedNamespace}".`, {
      code: AccountNamespaceMismatchError.code,
      details: input,
    });
  }
}

export class AccountHiddenSelectionError extends ArxBaseError {
  static readonly code = "account.hidden_not_selectable";

  constructor(identity: { accountId: AccountId } | { accountGroupId: AccountGroupId }) {
    super("Hidden accounts cannot be selected.", {
      code: AccountHiddenSelectionError.code,
      details: identity,
    });
  }
}

export class PrivateKeyAccountHiddenUnsupportedError extends ArxBaseError {
  static readonly code = "account.private_key_hide_unsupported";

  constructor(accountGroupId: AccountGroupId) {
    super(`Private-key account "${accountGroupId}" cannot be hidden.`, {
      code: PrivateKeyAccountHiddenUnsupportedError.code,
      details: { accountGroupId },
    });
  }
}

export class LastVisibleAccountHiddenError extends ArxBaseError {
  static readonly code = "account.last_visible_hide_unsupported";

  constructor(input: { accountGroupId: AccountGroupId; keySourceId: KeySourceId }) {
    super(`The last visible account from source "${input.keySourceId}" cannot be hidden.`, {
      code: LastVisibleAccountHiddenError.code,
      details: input,
    });
  }
}

export class AccountRemovalSelectionUnavailableError extends ArxBaseError {
  static readonly code = "account.removal_selection_unavailable";

  constructor() {
    super("Removing accounts would leave the wallet without a visible account selection.", {
      code: AccountRemovalSelectionUnavailableError.code,
    });
  }
}

export class AccountSelectionMissingError extends ArxBaseError {
  static readonly code = "account.selection_missing";

  constructor() {
    super("The wallet has no selected account group.", {
      code: AccountSelectionMissingError.code,
    });
  }
}
