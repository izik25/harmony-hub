import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { LevelMeter } from "./LevelMeter";

// Shared "nothing here yet" block, in the app's own language: the subject's icon over a level
// meter at rest (no signal yet), a line of copy and an optional call to action.
export function EmptyState({
  icon: Icon,
  title,
  action,
  className = "",
}: {
  icon: LucideIcon;
  title: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center px-6 py-10 text-center animate-fade-up ${className}`}
    >
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-muted text-brand-gold">
        <Icon className="h-6 w-6" />
      </span>
      <LevelMeter resting bars={12} className="mt-4 h-9 w-28" />
      <p className="mt-4 max-w-xs text-sm text-muted-foreground">{title}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
