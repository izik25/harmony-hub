/**
 * Post thumbnail: renders the AI-generated cover image when the post has one, otherwise falls
 * back to a generated animated gradient stand-in — no external image required.
 */
export function PostCoverBg({
  hue,
  seed,
  imageUrl,
}: {
  hue: number;
  seed: string;
  imageUrl?: string;
}) {
  if (imageUrl) {
    return (
      <div className="absolute inset-0" data-seed={seed}>
        <img src={imageUrl} alt="" className="h-full w-full object-cover" />
      </div>
    );
  }

  const h2 = (hue + 60) % 360;
  const h3 = (hue + 200) % 360;
  return (
    <div
      className="absolute inset-0"
      style={{
        background: `radial-gradient(120% 80% at 20% 20%, hsl(${hue} 90% 55% / 0.9), transparent 60%),
                     radial-gradient(120% 80% at 80% 30%, hsl(${h2} 95% 60% / 0.85), transparent 60%),
                     radial-gradient(140% 100% at 50% 90%, hsl(${h3} 95% 55% / 0.9), transparent 55%),
                     linear-gradient(180deg, #0a0014, #1a0033)`,
      }}
      data-seed={seed}
    >
      {/* fake film grain / scanlines */}
      <div
        className="absolute inset-0 opacity-25 mix-blend-overlay"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 3px)",
        }}
      />
    </div>
  );
}
