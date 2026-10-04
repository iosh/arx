import type { AccountId } from "@arx/core/accounts";
import { Avatar, Style } from "@dicebear/core";
import shapes from "@dicebear/styles/shapes.json";
import { useMemo } from "react";

const style = new Style(shapes);

export function AccountIdenticon({ accountId }: { accountId: AccountId }) {
  const src = useMemo(
    () => new Avatar(style, { seed: accountId, size: 36, borderRadius: 50, tags: [] }).toDataUri(),
    [accountId],
  );

  return <img alt="" width={36} height={36} className="size-9 shrink-0 rounded-full" src={src} draggable={false} />;
}
