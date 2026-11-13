import { cn } from "cn";
import type { ComponentProps, ReactNode } from "react";

export function NetworkUrlList({ className, ...props }: ComponentProps<"ul">) {
  return <ul className={cn("overflow-hidden rounded-2xl bg-card text-card-foreground", className)} {...props} />;
}

export function NetworkUrlRow({
  url,
  name,
  link = false,
  children,
}: {
  url: string;
  name?: string | undefined;
  link?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className="flex min-h-14 items-center gap-3 px-4 py-3 text-sm">
      {link ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          dir="ltr"
          title={name}
          className="min-w-0 flex-1 rounded-sm wrap-anywhere text-muted-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {url}
        </a>
      ) : (
        <span dir="ltr" className="min-w-0 flex-1 wrap-anywhere text-muted-foreground">
          {url}
        </span>
      )}
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </li>
  );
}
