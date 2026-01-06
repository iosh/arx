import type { ReactNode } from "react";
import { Paragraph, XStack, type XStackProps, YStack } from "tamagui";

export type ListItemProps = Omit<XStackProps, "children" | "right"> & {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  variant?: "card" | "flat";
};

export function ListItem({ title, subtitle, right, onPress, variant = "card", ...props }: ListItemProps) {
  const pressable = typeof onPress === "function";
  const isCard = variant === "card";

  return (
    <XStack
      alignItems="center"
      gap="$3"
      paddingVertical="$3"
      paddingHorizontal="$3"
      borderRadius="$md"
      backgroundColor={isCard ? "$cardBg" : "transparent"}
      borderWidth={isCard ? 1 : 0}
      borderColor={isCard ? "$border" : "transparent"}
      minWidth={0}
      cursor={pressable ? "pointer" : undefined}
      hoverStyle={pressable ? { backgroundColor: "$surface" } : undefined}
      pressStyle={pressable ? { opacity: 0.9 } : undefined}
      onPress={onPress}
      {...props}
    >
      <YStack flex={1} minWidth={0} gap="$1">
        <Paragraph color="$text" fontWeight="600" lineHeight="$4" numberOfLines={1}>
          {title}
        </Paragraph>
        {subtitle ? (
          <Paragraph color="$mutedText" fontSize="$2" numberOfLines={2}>
            {subtitle}
          </Paragraph>
        ) : null}
      </YStack>
      {right ? <XStack alignItems="center">{right}</XStack> : null}
    </XStack>
  );
}
