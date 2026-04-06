export type TransportFailureReason =
  | "disconnected"
  | "handshake_timeout"
  | "request_timeout"
  | "protocol_version_mismatch";

export type TransportFailure = Error & {
  kind: "transport_failure";
  reason: TransportFailureReason;
  data?: unknown;
};

const createTransportFailure = (
  reason: TransportFailureReason,
  input: { message: string; data?: unknown },
): TransportFailure => {
  const error = new Error(input.message) as TransportFailure;
  error.kind = "transport_failure";
  error.reason = reason;
  if (input.data !== undefined) {
    error.data = input.data;
  }
  return error;
};

export const isTransportFailure = (value: unknown): value is TransportFailure => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TransportFailure>;
  return (
    candidate.kind === "transport_failure" &&
    typeof candidate.reason === "string" &&
    typeof candidate.message === "string"
  );
};

export const transportFailures = {
  disconnected() {
    return createTransportFailure("disconnected", {
      message: "Transport disconnected.",
    });
  },

  handshakeTimeout() {
    return createTransportFailure("handshake_timeout", {
      message: "Handshake timed out. Try again.",
    });
  },

  requestTimeout() {
    return createTransportFailure("request_timeout", {
      message: "Request timed out",
    });
  },

  protocolVersionMismatch(protocolVersion: number) {
    return createTransportFailure("protocol_version_mismatch", {
      message: `Unsupported protocol version: ${String(protocolVersion)}`,
      data: { protocolVersion },
    });
  },
};
