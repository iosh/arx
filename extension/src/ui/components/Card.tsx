import { Card as TamaguiCard, type CardProps as TamaguiCardProps } from "tamagui";

export type CardProps = TamaguiCardProps & {
  padded?: boolean;
  bordered?: boolean;
};

export function Card({
  padded = true,
  bordered = true,
  padding,
  borderWidth,
  borderColor,
  backgroundColor,
  ...props
}: CardProps) {
  const resolvedPadding = padding ?? (padded ? "$3" : "$0");
  const resolvedBorderWidth = borderWidth ?? (bordered ? 1 : 0);

  return (
    <TamaguiCard
      padding={resolvedPadding}
      borderWidth={resolvedBorderWidth}
      borderColor={borderColor ?? "$border"}
      backgroundColor={backgroundColor ?? "$cardBg"}
      borderRadius="$lg"
      {...props}
    />
  );
}
