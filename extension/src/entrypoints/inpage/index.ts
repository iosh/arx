import {
  announceEip6963Provider,
  createEip155Provider,
  type Eip6963ProviderInfo,
  setEthereumProviderIfAbsent,
} from "@arx/provider/eip155";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { createInpageProviderChannel } from "@/transport/inpageProviderChannel";

const ARX_PROVIDER_ICON =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZyI+CiAgICA8ZGVmcz4KICAgICAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImRhcmtTcGFjZSIgeDE9IjAiIHkxPSIwIiB4Mj0iMjAwIiB5Mj0iMjAwIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CiAgICAgICAgICAgIDxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iIzNBM0EzQSIvPgogICAgICAgICAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMwNTA1MDUiLz4KICAgICAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPC9kZWZzPgogICAgPHJlY3Qgd2lkdGg9IjIwMCIgaGVpZ2h0PSIyMDAiIHJ4PSI0NSIgZmlsbD0idXJsKCNkYXJrU3BhY2UpIi8+CiAgICA8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTEwMCAzMEw0MCAxNzBINzVMMTAwIDExMEwxMjUgMTcwSDE2MEwxMDAgMzBaTTEwMCA5NUwxMTUgMTM1SDg1TDEwMCA5NVoiIGZpbGw9IiNGRkZGRkYiLz4KPC9zdmc+Cg==";

const createEip6963Uuid = (): string => {
  if (typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  // randomUUID is unavailable in non-secure HTTP page realms; getRandomValues remains available.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const createProviderInfo = (): Eip6963ProviderInfo => ({
  uuid: createEip6963Uuid(),
  name: "ARX Wallet",
  icon: ARX_PROVIDER_ICON,
  rdns: "com.arx.wallet",
});

export default defineUnlistedScript(() => {
  const provider = createEip155Provider({
    channel: createInpageProviderChannel({ targetWindow: window }),
  });

  announceEip6963Provider({
    targetWindow: window,
    provider,
    info: createProviderInfo(),
  });
  setEthereumProviderIfAbsent({ targetWindow: window, provider });
});
