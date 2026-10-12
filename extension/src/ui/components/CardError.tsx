import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

export function CardError({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <div
      id={id}
      role="alert"
      className="flex items-center gap-2 rounded-xl bg-destructive-subtle p-3 text-sm text-destructive-foreground"
    >
      <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
