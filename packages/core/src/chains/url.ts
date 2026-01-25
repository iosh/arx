const protocolOf = (value: string): string | null => {
  try {
    return new URL(value).protocol;
  } catch {
    return null;
  }
};

export const isUrlWithProtocols = (value: string, allowed: readonly string[]): boolean => {
  const protocol = protocolOf(value);
  return protocol ? allowed.includes(protocol) : false;
};

export const HTTP_PROTOCOLS = ["http:", "https:"] as const;
export const RPC_PROTOCOLS = ["http:", "https:", "ws:", "wss:"] as const;
