/**
 * Post thumbnail: renders the AI-generated cover image when the post has one, otherwise falls
 * back to a generated placeholder in the Night Studio style: a dark tinted base, two soft glows
 * and a level-meter silhouette. Deterministic per seed, no assets.
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
      {/* The studio signature: a level-meter silhouette whose shape comes from the seed, so each
          placeholder reads as "a take" rather than a generic orb. */}
      <div className="absolute inset-x-[12%] bottom-[14%] flex h-[38%] items-end gap-[3%]">
        {Array.from({ length: 14 }).map((_, i) => {
          const h = 22 + (((hash >> (i % 16)) + i * 37) % 70);
          return (
            <span
              key={i}
              className="flex-1 rounded-[2px] bg-white/14"
              style={{ height: `${h}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}
