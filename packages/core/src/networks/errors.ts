import { ArxBaseError } from "../errors.js";
import type { Namespace } from "../namespaces/types.js";
import type { ChainRef } from "./chainRef.js";

export class ChainNamespaceMismatchError extends ArxBaseError {
  static readonly code = "network.chain_namespace_mismatch";

  constructor(input: { chainRef: ChainRef; expectedNamespace: Namespace; actualNamespace: Namespace }) {
    super(`Chain "${input.chainRef}" does not belong to namespace "${input.expectedNamespace}".`, {
      code: ChainNamespaceMismatchError.code,
      details: input,
    });
  }
}

export class NetworkNotFoundError extends ArxBaseError {
  static readonly code = "network.not_found";

  constructor(chainRef: ChainRef) {
    super(`Network "${chainRef}" was not found.`, {
      code: NetworkNotFoundError.code,
      details: { chainRef },
    });
  }
}

export class NetworkAlreadyExistsError extends ArxBaseError {
  static readonly code = "network.already_exists";

  constructor(chainRef: ChainRef) {
    super(`Network "${chainRef}" already exists.`, {
      code: NetworkAlreadyExistsError.code,
      details: { chainRef },
    });
  }
}

export class NetworkHasPendingTransactionsError extends ArxBaseError {
  static readonly code = "network.has_pending_transactions";

  constructor(chainRef: ChainRef) {
    super(`Network "${chainRef}" has pending transactions.`, {
      code: NetworkHasPendingTransactionsError.code,
      details: { chainRef },
    });
  }
}

export class NetworkRpcEndpointInvalidError extends ArxBaseError {
  static readonly code = "network.rpc_endpoint_invalid";

  constructor(endpoint: string) {
    super("Network RPC endpoint must be an HTTP or HTTPS URL.", {
      code: NetworkRpcEndpointInvalidError.code,
      details: { endpoint },
    });
  }
}

export class NetworkRpcEndpointMismatchError extends ArxBaseError {
  static readonly code = "network.rpc_endpoint_mismatch";

  constructor(input: { endpoint: string; expectedChainRef: ChainRef; actualChainRef: ChainRef }) {
    super(`Network RPC endpoint reports "${input.actualChainRef}" instead of "${input.expectedChainRef}".`, {
      code: NetworkRpcEndpointMismatchError.code,
      details: input,
    });
  }
}

export class NetworkRpcEndpointReadError extends ArxBaseError {
  static readonly code = "network.rpc_endpoint_read_failed";

  constructor(input: { endpoint: string; cause: unknown }) {
    super("Could not read the RPC endpoint's chain identifier.", {
      code: NetworkRpcEndpointReadError.code,
      details: { endpoint: input.endpoint },
      cause: input.cause,
    });
  }
}

export class NetworkConfigurationChangedError extends ArxBaseError {
  static readonly code = "network.configuration_changed";

  constructor(chainRef: ChainRef) {
    super("The network configuration changed while this item was being edited.", {
      code: NetworkConfigurationChangedError.code,
      details: { chainRef },
    });
  }
}

export class NetworkRpcEndpointRequiredError extends ArxBaseError {
  static readonly code = "network.rpc_endpoint_required";

  constructor(chainRef: ChainRef) {
    super("A network must retain at least one RPC endpoint.", {
      code: NetworkRpcEndpointRequiredError.code,
      details: { chainRef },
    });
  }
}

export class NetworkBlockExplorerExistsError extends ArxBaseError {
  static readonly code = "network.block_explorer_exists";

  constructor(input: { chainRef: ChainRef; url: string }) {
    super("This block explorer is already configured for the network.", {
      code: NetworkBlockExplorerExistsError.code,
      details: input,
    });
  }
}
