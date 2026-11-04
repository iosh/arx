import { Avatar, Style } from "@dicebear/core";
import shapes from "@dicebear/styles/shapes.json";
import { useMemo } from "react";

const style = new Style(shapes);

export function AccountIdenticon({ seed, size = 36 }: { seed: string; size?: number }) {
  const src = useMemo(() => new Avatar(style, { seed, size: 36, borderRadius: 50, tags: [] }).toDataUri(), [seed]);

  return <img alt="" width={size} height={size} className="shrink-0 rounded-full" src={src} draggable={false} />;
}
