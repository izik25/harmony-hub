/**
 * Post thumbnail: renders the AI-generated cover image when the post has one, otherwise falls
 * back to a generated placeholder in the Night Studio style — a dark tinted base, two soft neon
 * glows and the concentric "speaker" rings of the logo mark. Deterministic per seed, no assets.
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

  // Deterministic little variety from the seed so covers don't all match.
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const accentHue = (hue + 150 + (hash % 60)) % 360;
  const glowX = 20 + (hash % 60);
  const glowY = 15 + ((hash >> 4) % 45);

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        backgroundColor: `hsl(${hue} 35% 11%)`,
        backgroundImage: `radial-gradient(circle at ${glowX}% ${glowY}%, hsl(${hue} 90% 58% / 0.55), transparent 58%), radial-gradient(circle at ${100 - glowX}% 95%, hsl(${accentHue} 90% 58% / 0.4), transparent 55%)`,
      }}
      data-seed={seed}
    >
      <div className="absolute left-1/2 top-[45%] aspect-square w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />
      <div className="absolute left-1/2 top-[45%] aspect-square w-[46%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15" />
      <div className="absolute left-1/2 top-[45%] aspect-square w-[14%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/15" />
    </div>
  );
}
