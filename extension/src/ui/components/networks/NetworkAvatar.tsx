export function NetworkAvatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-muted-foreground"
    >
      {Array.from(name)[0]?.toUpperCase()}
    </span>
  );
}
