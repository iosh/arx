import type { ReactNode } from "react";
import { H2, Paragraph, ScrollView, YStack, type YStackProps } from "tamagui";

export type ScreenProps = Omit<YStackProps, "children"> & {
  title?: string;
  subtitle?: string;
  scroll?: boolean;
  padded?: boolean;
  footer?: ReactNode;
  children: ReactNode;
};

export function Screen({ title, subtitle, scroll = true, padded = true, footer, children, ...props }: ScreenProps) {
  const padding = padded ? "$4" : "$0";
  const contentPaddingBottom = footer ? "$8" : padding;

  return (
    <YStack flex={1} backgroundColor="$bg" {...props}>
      {title ? (
        <YStack width="100%" maxWidth={600} alignSelf="center" padding={padding} paddingBottom="$3" gap="$1">
          <H2 color="$text">{title}</H2>
          {subtitle ? (
            <Paragraph color="$mutedText" fontSize="$2">
              {subtitle}
            </Paragraph>
          ) : null}
        </YStack>
      ) : null}

      {scroll ? (
        <ScrollView flex={1} showsVerticalScrollIndicator={false}>
          <YStack
            width="100%"
            maxWidth={600}
            alignSelf="center"
            padding={padding}
            paddingBottom={contentPaddingBottom}
            minWidth={0}
          >
            {children}
          </YStack>
        </ScrollView>
      ) : (
        <YStack
          flex={1}
          width="100%"
          maxWidth={600}
          alignSelf="center"
          padding={padding}
          paddingBottom={contentPaddingBottom}
          minWidth={0}
        >
          {children}
        </YStack>
      )}

      {footer ? (
        <YStack borderTopWidth={1} borderColor="$border" backgroundColor="$bg">
          <YStack width="100%" maxWidth={600} alignSelf="center" padding={padding}>
            {footer}
          </YStack>
        </YStack>
      ) : null}
    </YStack>
  );
}
