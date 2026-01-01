import type { ReactNode } from "react";
import { Paragraph, YStack } from "tamagui";
import { Button, type ButtonVariant } from "./Button";
import { Card } from "./Card";

export type EmptyStateAction = {
  label: ReactNode;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
};

export type EmptyStateProps = {
  title: ReactNode;
  message?: ReactNode;
  action?: EmptyStateAction;
};

export function EmptyState({ title, message, action }: EmptyStateProps) {
  return (
    <Card padded bordered backgroundColor="$cardBg" borderColor="$border">
      <YStack gap="$2" minWidth={0}>
        <Paragraph color="$text" fontWeight="600" fontSize="$section">
          {title}
        </Paragraph>
        {message ? (
          <Paragraph color="$mutedText" fontSize="$caption">
            {message}
          </Paragraph>
        ) : null}
        {action ? (
          <YStack paddingTop="$1">
            <Button
              variant={action.variant ?? "secondary"}
              onPress={action.onPress}
              loading={action.loading}
              disabled={action.disabled}
            >
              {action.label}
            </Button>
          </YStack>
        ) : null}
      </YStack>
    </Card>
  );
}
