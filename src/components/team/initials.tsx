// ============================================================
// Overlapping initials circles for the people on a card or row
// (posts, collection tasks, collabs). Full name on hover.
// ============================================================

import { cn } from '@/lib/utils';

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function Initials({
  names,
  max = 4,
  className,
}: {
  names: string[];
  max?: number;
  className?: string;
}) {
  if (names.length === 0) return null;
  return (
    <span className={cn('flex shrink-0 -space-x-1.5', className)}>
      {names.slice(0, max).map((name, i) => (
        <span
          key={`${name}-${i}`}
          title={name}
          className="bg-primary/15 text-primary ring-card flex size-6 items-center justify-center rounded-full text-[10px] font-semibold ring-2"
        >
          {initialsOf(name)}
        </span>
      ))}
      {names.length > max && (
        <span className="bg-muted text-muted-foreground ring-card flex size-6 items-center justify-center rounded-full text-[10px] ring-2">
          +{names.length - max}
        </span>
      )}
    </span>
  );
}
