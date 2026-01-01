import type { ReactNode } from "react";
import { Image, Paragraph, XStack, YStack } from "tamagui";

export type ChainBadgeSize = "sm" | "md";

export type ChainBadgeProps = {
  chainRef: string;
  displayName: string;
  iconUrl?: string | null;
  size?: ChainBadgeSize;
  showChainRef?: boolean;
  right?: ReactNode;
};

// Extract initials from display name (1-2 letters)
function getInitial(displayName: string) {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) {
    const first = words[0][0];
    return first ? first.toUpperCase() : "?";
  }
  // Multiple words: take first letter of first two words (e.g. "Ethereum Mainnet" -> "EM")
  const first = words[0][0];
  const second = words[1][0];
  return first && second ? `${first}${second}`.toUpperCase() : first ? first.toUpperCase() : "?";
}

export function ChainBadge({
  chainRef,
  displayName,
  iconUrl,
  size = "md",
  showChainRef = true,
  right,
}: ChainBadgeProps) {
  const iconSize = size === "sm" ? 18 : 22;
  const initial = getInitial(displayName);

  return (
    <XStack alignItems="center" gap="$2" minWidth={0}>
      {iconUrl ? (
        <Image
          source={{ uri: iconUrl }}
          width={iconSize}
          height={iconSize}
          borderRadius={iconSize}
          backgroundColor="$surface"
          borderWidth={1}
          borderColor="$border"
        />
      ) : (
        <YStack
          width={iconSize}
          height={iconSize}
          borderRadius={iconSize}
          alignItems="center"
          justifyContent="center"
          backgroundColor="$surface"
          borderWidth={1}
          borderColor="$border"
        >
          <Paragraph color="$text" fontSize={size === "sm" ? "$2" : "$3"} fontWeight="700" lineHeight={iconSize}>
            {initial}
          </Paragraph>
        </YStack>
      )}

      <YStack flex={1} minWidth={0}>
        <Paragraph color="$text" fontWeight="600" numberOfLines={1}>
          {displayName}
        </Paragraph>
        {showChainRef ? (
          <Paragraph color="$mutedText" fontFamily="$mono" fontSize="$2" numberOfLines={1}>
            {chainRef}
          </Paragraph>
        ) : null}
      </YStack>

      {right ? <XStack flexShrink={0}>{right}</XStack> : null}
    </XStack>
  );
}
