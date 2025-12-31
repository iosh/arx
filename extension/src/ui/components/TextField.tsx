import type { ReactNode } from "react";
import { useId } from "react";
import { Input, type InputProps, Label, Paragraph, XStack, YStack } from "tamagui";

export type TextFieldProps = Omit<InputProps, "disabled" | "right"> & {
  label?: ReactNode;
  helperText?: ReactNode;
  errorText?: ReactNode;
  disabled?: boolean;
  endAdornment?: ReactNode;
  endAdornmentWidth?: InputProps["paddingRight"]; // Allow caller to override if needed
  id?: string;
};

export function TextField({
  label,
  helperText,
  errorText,
  disabled = false,
  endAdornment,
  endAdornmentWidth,
  id,
  editable,
  ...inputProps
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hasError = Boolean(errorText);

  return (
    <YStack gap="$1" minWidth={0}>
      {label ? (
        <Label htmlFor={inputId} color="$text" fontWeight="600">
          {label}
        </Label>
      ) : null}

      <YStack position="relative" minWidth={0}>
        <Input
          id={inputId}
          disabled={disabled}
          editable={disabled ? false : editable}
          backgroundColor="$surface"
          borderColor={hasError ? "$danger" : "$border"}
          focusStyle={{ borderColor: hasError ? "$danger" : "$accent" }}
          color="$text"
          placeholderTextColor="$mutedText"
          paddingRight={endAdornment ? (endAdornmentWidth ?? "$8") : undefined}
          minWidth={0}
          {...inputProps}
        />

        {endAdornment ? (
          <XStack position="absolute" right="$2" top={0} bottom={0} alignItems="center">
            {endAdornment}
          </XStack>
        ) : null}
      </YStack>

      {hasError ? (
        <Paragraph color="$danger" fontSize="$2">
          {errorText}
        </Paragraph>
      ) : helperText ? (
        <Paragraph color="$mutedText" fontSize="$2">
          {helperText}
        </Paragraph>
      ) : null}
    </YStack>
  );
}
