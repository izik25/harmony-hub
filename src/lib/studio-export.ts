// Bundles the finished track as a studio-quality download: the source audio file plus its cover
// image, saved as two separate files — browsers have no way to embed artwork into a WAV/webm the
// way ID3 does for MP3s, so this is the simplest format that actually round-trips both assets.
function extensionFromUrl(url: string, fallback: string): string {
  const match = /\.([a-z0-9]{2,4})(?:\?.*)?$/i.exec(url);
  return match ? match[1].toLowerCase() : fallback;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadStudioExport({
  audioUrl,
  coverUrl,
  fileName,
}: {
  audioUrl: string;
  coverUrl: string;
  fileName: string;
}) {
  const audioBlob = await fetch(audioUrl).then((r) => r.blob());
  triggerBlobDownload(audioBlob, `${fileName}.${extensionFromUrl(audioUrl, "wav")}`);

  if (coverUrl) {
    // A short gap keeps the browser from treating the second auto-triggered download as a popup
    // and blocking it.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const coverBlob = await fetch(coverUrl).then((r) => r.blob());
    triggerBlobDownload(coverBlob, `${fileName}-cover.${extensionFromUrl(coverUrl, "jpg")}`);
  }
}
