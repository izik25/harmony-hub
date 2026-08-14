import type { ShareOnlyPlatformId } from "./config";

// Spotify, Apple Music and SoundCloud have no public "upload a track as an independent artist"
// API — Spotify and Apple Music require going through a distributor (or their manual
// for-artists dashboards), and SoundCloud's upload API needs a partner-approved app. So instead
// of a real upload, this downloads the track and hands the user off to each platform's own
// upload page with the title already copied to their clipboard to paste in.
export const SHARE_ONLY_META: Record<ShareOnlyPlatformId, { name: string; uploadUrl: string }> = {
  spotify: { name: "Spotify for Artists", uploadUrl: "https://artists.spotify.com/" },
  apple_music: { name: "Apple Music for Artists", uploadUrl: "https://artists.apple.com/" },
  soundcloud: { name: "SoundCloud", uploadUrl: "https://soundcloud.com/upload" },
};

export async function shareToExternalPlatform(
  platform: ShareOnlyPlatformId,
  track: { audioUrl: string; title: string },
): Promise<void> {
  const meta = SHARE_ONLY_META[platform];

  const a = document.createElement("a");
  a.href = track.audioUrl;
  a.download = `${(track.title || "sona-track").replace(/[^a-z0-9\-_ ]/gi, "").trim() || "sona-track"}.wav`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  try {
    await navigator.clipboard.writeText(track.title);
  } catch {
    // Clipboard access can be denied (permissions, non-secure context) — non-fatal, the download
    // and the new tab below still get the user most of the way there.
  }

  window.open(meta.uploadUrl, "_blank", "noopener,noreferrer");
}
