import type { ReactNode } from "react";
import { type GetProps, Spinner, styled, Button as TamaguiButton } from "tamagui";

const ButtonFrame = styled(TamaguiButton, {
  name: "ArxButton",
  borderWidth: 1,
  borderRadius: "$md",
  borderColor: "$border",

  variants: {
    variant: {
      secondary: {
        backgroundColor: "$surface",
        color: "$text",
        borderColor: "$border",
        hoverStyle: { backgroundColor: "$cardBg" },
        pressStyle: { opacity: 0.9 },
        focusVisibleStyle: { borderColor: "$accent" },
      },
      primary: {
        backgroundColor: "$accent",
        color: "$accentText",
        borderColor: "$accent",
        hoverStyle: { backgroundColor: "$accentHover", borderColor: "$accentHover" },
        pressStyle: { backgroundColor: "$accentPress", borderColor: "$accentPress" },
        focusVisibleStyle: { borderColor: "$accentHover" },
      },
      danger: {
        backgroundColor: "$danger",
        color: "$dangerText",
        borderColor: "$danger",
        hoverStyle: { backgroundColor: "$dangerHover", borderColor: "$dangerHover" },
        pressStyle: { backgroundColor: "$dangerPress", borderColor: "$dangerPress" },
        focusVisibleStyle: { borderColor: "$dangerHover" },
      },
      ghost: {
        chromeless: true,
        borderWidth: 0,
        backgroundColor: "transparent",
        color: "$text",
        hoverStyle: { backgroundColor: "$surface" },
        pressStyle: { opacity: 0.9 },
        focusVisibleStyle: { backgroundColor: "$surface" },
      },
    },
  },

  defaultVariants: {
    variant: "secondary",
  },

  disabledStyle: {
    opacity: 0.55,
    cursor: "not-allowed",
  },
});

type ButtonFrameProps = GetProps<typeof ButtonFrame>;
export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export type ButtonProps = Omit<ButtonFrameProps, "variant"> & {
  variant?: ButtonVariant;
  loading?: boolean;
  loadingText?: ReactNode;
  spinnerSize?: "small" | "large";
  spinnerPosition?: "before" | "after" | "replace";
};

export function Button({
  variant = "secondary",
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
  const isDisabled = disabled || loading;
  const { textProps, ...rest } = props;
  const spinner = loading ? <Spinner size={spinnerSize} color="$color" /> : null;

  const mergedTextProps = {
    ...textProps,
    cursor: isDisabled ? "not-allowed" : textProps?.cursor,
  };

  if (loading && spinnerPosition === "replace") {
    return (
      <ButtonFrame
        variant={variant}
        disabled={isDisabled}
        aria-busy={loading}
        icon={spinner}
        textProps={mergedTextProps}
        {...rest}
      />
    );
  }

  const displayIcon = loading && spinnerPosition === "before" ? spinner : icon;
  const displayIconAfter = loading && spinnerPosition === "after" ? spinner : iconAfter;

  return (
    <ButtonFrame
      variant={variant}
      disabled={isDisabled}
      aria-busy={loading}
      icon={displayIcon}
      iconAfter={displayIconAfter}
      textProps={mergedTextProps}
      {...rest}
    >
      {loading ? (loadingText ?? children) : children}
    </ButtonFrame>
  );
}
