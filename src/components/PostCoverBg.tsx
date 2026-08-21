/**
 * Post thumbnail: renders the AI-generated cover image when the post has one, otherwise falls
 * back to a generated flat-color placeholder — no gradients, no external image required.
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
  const offsetX = 15 + (hash % 55);
  const offsetY = 10 + ((hash >> 4) % 60);
  const shapeSize = 130 + ((hash >> 8) % 70);

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ backgroundColor: `hsl(${hue} 55% 22%)` }}
      data-seed={seed}
    >
      <div
        className="absolute rounded-full"
        style={{
          width: `${shapeSize}%`,
          height: `${shapeSize}%`,
          left: `${offsetX}%`,
          top: `${offsetY}%`,
          transform: "translate(-50%, -50%)",
          backgroundColor: `hsl(${accentHue} 65% 45%)`,
        }}
      />
    </div>
  );
}
