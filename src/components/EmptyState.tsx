import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// Shared "nothing here yet" block: an icon inside the logo's speaker rings, a line of copy and an
// optional call to action — so empty screens read as designed rather than as a stray sentence.
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
      <div className="relative grid h-24 w-24 place-items-center">
        <span className="absolute inset-0 rounded-full border border-white/10" />
        <span className="absolute inset-3 rounded-full border border-brand-coral/30 shadow-pop-coral" />
        <span className="relative grid h-12 w-12 place-items-center rounded-full bg-card text-brand-coral">
          <Icon className="h-6 w-6" />
        </span>
      </div>
      <p className="mt-4 max-w-xs text-sm text-muted-foreground">{title}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
