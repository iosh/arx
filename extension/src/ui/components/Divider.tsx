import type { ComponentProps } from "react";
import { Separator } from "tamagui";

export type DividerProps = ComponentProps<typeof Separator>;

export function Divider(props: DividerProps) {
  return <Separator backgroundColor="$border" {...props} />;
}
