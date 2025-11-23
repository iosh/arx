import { Button as TamaguiButton, Spinner, type ButtonProps as TamaguiButtonProps } from "tamagui";

// Extended button props with loading state
export interface ButtonProps extends TamaguiButtonProps {
  /** Show loading spinner and disable button */
  loading?: boolean;
  /** Custom loading text (optional, defaults to original children) */
  loadingText?: string;
  /** Spinner size (default: 'small') */
  spinnerSize?: "small" | "large";
  /** Spinner position relative to text (default: 'before') */
  spinnerPosition?: "before" | "after" | "replace";
}

/**
 * Enhanced Button component with loading state support
 *
 * Features:
 * - Auto-disable when loading
 * - Spinner indicator with customizable position
 * - Preserves all original Tamagui Button functionality
 *
 * @example
 * <Button loading={isLoading} onPress={handleSubmit}>
 *   Submit
 * </Button>
 */
export function Button({
  loading = false,
  loadingText,
  spinnerSize = "small",
  spinnerPosition = "before",
  disabled,
  children,
  icon,
  iconAfter,
  ...props
}: ButtonProps) {
  // Disable button when loading
  const isDisabled = disabled || loading;

  // Determine what to display based on loading state and position
  const displayContent = loading ? loadingText || children : children;

  // Spinner component
  const spinner = loading ? <Spinner size={spinnerSize} color="$color" /> : null;

  // Configure icon props based on spinner position
  let displayIcon = icon;
  let displayIconAfter = iconAfter;

  if (loading) {
    if (spinnerPosition === "before") {
      displayIcon = spinner;
    } else if (spinnerPosition === "after") {
      displayIconAfter = spinner;
    } else if (spinnerPosition === "replace") {
      // When replace, show only spinner without text
      return (
        <TamaguiButton
          disabled={isDisabled}
          icon={spinner}
          {...props}
        />
      );
    }
  }

  return (
    <TamaguiButton
      disabled={isDisabled}
      icon={displayIcon}
      iconAfter={displayIconAfter}
      {...props}
    >
      {displayContent}
    </TamaguiButton>
  );
}
