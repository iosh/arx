import { Check, Copy } from "lucide-react";
import { from as addressFrom } from "ox/Address";
import { useEffect, useMemo, useState } from "react";
import { Paragraph, type TextProps, XStack } from "tamagui";
import { copyToClipboard } from "@/ui/lib/clipboard";
import { pushToast } from "@/ui/lib/toast";
import { Button } from "./Button";

export type AddressDisplayProps = {
  address: string;
  namespace: string;
  chainRef?: string | null;
  copyable?: boolean;
  toastOnCopied?: boolean;
  fontSize?: TextProps["fontSize"];
  expandedFontSize?: TextProps["fontSize"];
  fontWeight?: TextProps["fontWeight"];
  color?: TextProps["color"];
};

function deriveExpandedFontSize(fontSize: TextProps["fontSize"] | undefined): TextProps["fontSize"] | undefined {
  // Common case in this codebase: Tamagui font tokens like "$6".
  if (typeof fontSize === "string") {
    const match = /^\$(\d+)$/.exec(fontSize);
    if (match) {
      const current = Number(match[1]);
      const next = Math.max(1, current - 2);
      return `$${next}` as TextProps["fontSize"];
    }
  }
  return fontSize;
}

function isEvmNamespace(namespace: string, chainRef?: string | null) {
  if (namespace === "eip155") return true;
  return typeof chainRef === "string" && chainRef.startsWith("eip155:");
}

function formatFullAddress(address: string, namespace: string, chainRef?: string | null) {
  const trimmed = address.trim();

  if (isEvmNamespace(namespace, chainRef)) {
    try {
      return addressFrom(trimmed, { checksum: true });
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function formatShortAddress(address: string, namespace: string, chainRef?: string | null) {
  const full = formatFullAddress(address, namespace, chainRef);

  if (isEvmNamespace(namespace, chainRef)) {
    const ensured = full.startsWith("0x") ? full : `0x${full}`;
    if (ensured.length <= 2 + 6 + 1 + 4) return ensured;
    return `${ensured.slice(0, 2 + 6)}…${ensured.slice(-4)}`;
  }

  // TODO: Replace with shortCfxAddress() tool when available
  if (namespace === "conflux") {
    const idx = full.indexOf(":");
    if (idx > 0) {
      const prefix = full.slice(0, idx + 1); // "cfx:" / "cfxtest:" / ...
      const rest = full.slice(idx + 1);
      if (rest.length <= 8 + 1 + 6) return full;
      return `${prefix}${rest.slice(0, 8)}…${rest.slice(-6)}`;
    }
    if (full.length <= 10 + 1 + 6) return full;
    return `${full.slice(0, 10)}…${full.slice(-6)}`;
  }

  if (full.length <= 8 + 1 + 6) return full;
  return `${full.slice(0, 8)}…${full.slice(-6)}`;
}

export function AddressDisplay({
  address,
  namespace,
  chainRef,
  copyable = true,
  toastOnCopied = false,
  fontSize = "$3",
  expandedFontSize,
  fontWeight,
  color = "$text",
}: AddressDisplayProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const full = useMemo(() => formatFullAddress(address, namespace, chainRef), [address, chainRef, namespace]);
  const short = useMemo(() => formatShortAddress(address, namespace, chainRef), [address, chainRef, namespace]);

  useEffect(() => {
    if (!copied) return;

    const handle = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(handle);
  }, [copied]);

  const label = expanded ? full : short;
  const resolvedFontSize = expanded ? (expandedFontSize ?? deriveExpandedFontSize(fontSize)) : fontSize;

  return (
    <XStack
      role="button"
      aria-label={`Address: ${short}. Click to ${expanded ? "collapse" : "expand"}`}
      tabIndex={0}
      alignItems="center"
      gap="$2"
      minWidth={0}
      onPress={() => setExpanded((v) => !v)}
      cursor="pointer"
      hoverStyle={{ opacity: 0.9 }}
      pressStyle={{ opacity: 0.85 }}
    >
      <Paragraph
        flex={1}
        minWidth={0}
        fontFamily="$mono"
        fontSize={resolvedFontSize}
        fontWeight={fontWeight}
        color={color}
        numberOfLines={expanded ? undefined : 1}
        style={
          expanded
            ? ({
                overflowX: "auto",
                overflowY: "hidden",
                whiteSpace: "nowrap",
                wordBreak: "normal",
                overflowWrap: "normal",
              } as const)
            : undefined
        }
      >
        {label}
      </Paragraph>

      {copyable ? (
        <Button
          variant="ghost"
          circular
          size="$2"
          aria-label={copied ? "Copied" : "Copy address"}
          icon={copied ? <Check size={18} /> : <Copy size={18} />}
          onPress={(e) => {
            e.preventDefault();
            e.stopPropagation();

            copyToClipboard(full)
              .then(() => {
                setCopied(true);
                if (toastOnCopied) {
                  pushToast({ kind: "success", message: "Copied", dedupeKey: "address-copied" });
                }
              })
              .catch((error) => {
                console.warn("[AddressDisplay] failed to copy", error);
              });
          }}
        />
      ) : null}
    </XStack>
  );
}
