type ProviderSurfaceErrorInput = {
  message?: string;
};

type ProviderCustomErrorInput = {
  code: number;
  message: string;
};

export class ProviderSurfaceError extends Error {
  readonly code: number;

  protected constructor(code: number, fallbackMessage: string, input: ProviderSurfaceErrorInput = {}) {
    super(input.message ?? fallbackMessage);
    this.name = new.target.name;
    this.code = code;
  }
}

export class JsonRpcParseError extends ProviderSurfaceError {
  constructor(input: ProviderSurfaceErrorInput = {}) {
    super(
      -32700,
      "Invalid JSON was received by the server. An error occurred on the server while parsing the JSON text.",
      input,
    );
  }
}

export class JsonRpcInvalidRequestError extends ProviderSurfaceError {
  constructor(input: ProviderSurfaceErrorInput = {}) {
    super(-32600, "The JSON sent is not a valid Request object.", input);
  }
}

export class JsonRpcInvalidParamsError extends ProviderSurfaceError {
  constructor(input: ProviderSurfaceErrorInput = {}) {
    super(-32602, "Invalid method parameter(s).", input);
  }
}

export class JsonRpcMethodNotFoundError extends ProviderSurfaceError {
  constructor(input: ProviderSurfaceErrorInput = {}) {
    super(-32601, "The method does not exist / is not available.", input);
  }
}

export class JsonRpcInternalError extends ProviderSurfaceError {
  constructor(input: ProviderSurfaceErrorInput = {}) {
    super(-32603, "Internal JSON-RPC error.", input);
  }
}

export class ProviderDisconnectedError extends ProviderSurfaceError {
  constructor(input: ProviderSurfaceErrorInput = {}) {
    super(4900, "The provider is disconnected from all chains.", input);
  }
}

export class ProviderUnauthorizedError extends ProviderSurfaceError {
  constructor(input: ProviderSurfaceErrorInput = {}) {
    super(4100, "The requested account and/or method has not been authorized by the user.", input);
  }
}

export class ProviderUserRejectedRequestError extends ProviderSurfaceError {
  constructor(input: ProviderSurfaceErrorInput = {}) {
    super(4001, "User rejected the request.", input);
  }
}

export class ProviderUnsupportedMethodError extends ProviderSurfaceError {
  constructor(input: ProviderSurfaceErrorInput = {}) {
    super(4200, "The requested method is not supported by this Ethereum provider.", input);
  }
}

export class ProviderCustomError extends ProviderSurfaceError {
  constructor(input: ProviderCustomErrorInput) {
    super(input.code, input.message, input);
  }
}
