import {
  Cat,
  Crown,
  Disc3,
  Drama,
  Flower2,
  Gem,
  Glasses,
  Mic,
  PartyPopper,
  Rabbit,
  Rocket,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Gifts drawn in the app's own icon set (one stroke, one weight, palette colours) instead of OS
 * emoji, which render differently on every phone. An unknown key falls back to its emoji so a
 * gift added server-side still shows something.
 */
const GLYPHS: Record<string, { Icon: LucideIcon; tone: string }> = {
  rose: { Icon: Flower2, tone: "text-brand-coral" },
  mic: { Icon: Mic, tone: "text-brand-gold" },
  disc: { Icon: Disc3, tone: "text-brand-gold" },
  diamond: { Icon: Gem, tone: "text-brand-indigo" },
  crown: { Icon: Crown, tone: "text-brand-gold" },
  rocket: { Icon: Rocket, tone: "text-brand-coral" },
  partyhat: { Icon: PartyPopper, tone: "text-brand-coral" },
  sunglasses: { Icon: Glasses, tone: "text-brand-indigo" },
  mask: { Icon: Drama, tone: "text-brand-indigo" },
  catears: { Icon: Cat, tone: "text-brand-teal" },
  bunnyears: { Icon: Rabbit, tone: "text-brand-teal" },
};

export function GiftGlyph({
  giftKey,
  emoji,
  className,
}: {
  giftKey: string;
  emoji: string;
  className?: string;
}) {
  const glyph = GLYPHS[giftKey];
  if (!glyph) {
    return (
      <span aria-hidden className={cn("text-3xl leading-none", className)}>
        {emoji}
      </span>
    );
  }
  const { Icon, tone } = glyph;
  return (
    <span
      aria-hidden
      className={cn("grid h-11 w-11 place-items-center rounded-xl bg-muted", tone, className)}
    >
      <Icon className="h-6 w-6" strokeWidth={1.75} />
    </span>
  );
}
