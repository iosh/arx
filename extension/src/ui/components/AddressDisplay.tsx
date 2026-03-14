import { Check, Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Paragraph, type TextProps, XStack } from "tamagui";
import { copyToClipboard } from "@/ui/lib/clipboard";
import { pushToast } from "@/ui/lib/toast";
import { Button } from "./Button";

export type AddressDisplayProps = {
  address: string;
  displayAddress?: string | null;
  copyable?: boolean;
  toastOnCopied?: boolean;

  interactive?: boolean;
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

const HEX_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function resolveDisplayAddress(address: string, displayAddress?: string | null) {
  const formatted = displayAddress?.trim();
  return formatted && formatted.length > 0 ? formatted : address.trim();
}

function formatShortAddress(address: string) {
  if (HEX_ADDRESS_PATTERN.test(address)) {
    if (address.length <= 2 + 6 + 1 + 4) return address;
    return `${address.slice(0, 2 + 6)}…${address.slice(-4)}`;
  }

  const namespaceSeparator = address.indexOf(":");
  if (namespaceSeparator > 0) {
    const prefix = address.slice(0, namespaceSeparator + 1);
    const rest = address.slice(namespaceSeparator + 1);
    if (rest.length <= 8 + 1 + 6) return address;
    return `${prefix}${rest.slice(0, 8)}…${rest.slice(-6)}`;
  }

  if (address.length <= 8 + 1 + 6) return address;
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function AddressDisplay({
  address,
  displayAddress,
  copyable = true,
  toastOnCopied = false,
  interactive = true,
  fontSize = "$3",
  expandedFontSize,
  fontWeight,
  color = "$text",
}: AddressDisplayProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const full = useMemo(() => resolveDisplayAddress(address, displayAddress), [address, displayAddress]);
  const short = useMemo(() => formatShortAddress(full), [full]);

  useEffect(() => {
    if (!copied) return;

    const handle = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(handle);
  }, [copied]);

  const label = expanded ? full : short;
  const resolvedFontSize = expanded ? (expandedFontSize ?? deriveExpandedFontSize(fontSize)) : fontSize;

  const pressableProps = interactive
    ? {
        role: "button" as const,
        "aria-label": `Address: ${short}. Click to ${expanded ? "collapse" : "expand"}`,
        tabIndex: 0,
        cursor: "pointer",
        hoverStyle: { opacity: 0.9 },
        pressStyle: { opacity: 0.85 },
        onPress: () => setExpanded((v) => !v),
      }
    : {};

  return (
    <XStack alignItems="center" gap="$2" minWidth={0} {...pressableProps}>
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
            e?.preventDefault?.();
            e?.stopPropagation?.();

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
