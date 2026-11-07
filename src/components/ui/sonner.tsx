import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Toasts sit on the raised panel with a hairline, like every other overlay. Meaning is carried by
// the icon colour (teal success, coral error, marigold info) rather than by tinting the whole toast
// in off-palette blues and greens.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      // Sonner's own theme CSS outranks utility classes for these, so set its variables directly.
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-border": "var(--hairline-strong)",
          "--normal-text": "var(--foreground)",
          "--border-radius": "16px",
        } as React.CSSProperties
      }
      offset={{ top: "calc(env(safe-area-inset-top) + 12px)" }}
      mobileOffset={{ top: "calc(env(safe-area-inset-top) + 8px)", left: 12, right: 12 }}
      toastOptions={{
        classNames: {
          toast:
            "group toast font-sans group-[.toaster]:rounded-2xl group-[.toaster]:border group-[.toaster]:border-[var(--hairline-strong)] group-[.toaster]:bg-popover group-[.toaster]:text-foreground group-[.toaster]:shadow-pop-lg",
          title: "group-[.toast]:font-semibold",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:rounded-lg group-[.toast]:bg-brand-coral group-[.toast]:text-white",
          cancelButton:
            "group-[.toast]:rounded-lg group-[.toast]:bg-muted group-[.toast]:text-foreground",
          success: "[&_[data-icon]]:text-brand-teal",
          error: "[&_[data-icon]]:text-danger",
          info: "[&_[data-icon]]:text-brand-gold",
          warning: "[&_[data-icon]]:text-brand-gold",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
