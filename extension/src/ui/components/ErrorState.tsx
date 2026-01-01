import type { ReactNode } from "react";
import { Paragraph, YStack } from "tamagui";
import { Button, type ButtonVariant } from "./Button";
import { Card } from "./Card";

export type ErrorStateAction = {
  label: ReactNode;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
};

export type ErrorStateProps = {
  title: ReactNode;
  message?: ReactNode;
  primaryAction?: ErrorStateAction;
  secondaryAction?: ErrorStateAction;
};

export function ErrorState({ title, message, primaryAction, secondaryAction }: ErrorStateProps) {
  return (
    <Card padded bordered backgroundColor="$surface" borderColor="$danger">
      <YStack gap="$2" minWidth={0}>
        <Paragraph color="$danger" fontWeight="600" fontSize="$section">
          {title}
        </Paragraph>
        {message ? (
          <Paragraph color="$mutedText" fontSize="$caption">
            {message}
          </Paragraph>
        ) : null}
        {primaryAction || secondaryAction ? (
          <YStack gap="$2" paddingTop="$1">
            {primaryAction ? (
              <Button
                variant={primaryAction.variant ?? "primary"}
                onPress={primaryAction.onPress}
                loading={primaryAction.loading}
                disabled={primaryAction.disabled}
              >
                {primaryAction.label}
              </Button>
            ) : null}
            {secondaryAction ? (
              <Button
                variant={secondaryAction.variant ?? "secondary"}
                onPress={secondaryAction.onPress}
                loading={secondaryAction.loading}
                disabled={secondaryAction.disabled}
              >
                {secondaryAction.label}
              </Button>
            ) : null}
          </YStack>
        ) : null}
      </YStack>
    </Card>
  );
}
