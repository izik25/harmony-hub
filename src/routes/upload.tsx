import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Upload, Music, Mic, Radio, Play, Globe, Lock } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";

export const Route = createFileRoute("/upload")({
  component: UploadPage,
});

const types = [
  { key: "cover", icon: Mic, label: "Cover" },
  { key: "original", icon: Music, label: "Original" },
  { key: "djset", icon: Radio, label: "DJ Set" },
  { key: "teaser", icon: Play, label: "Teaser" },
] as const;

function UploadPage() {
  const { t } = useTranslation();
  const [type, setType] = useState<(typeof types)[number]["key"]>("cover");
  const [visibility, setV] = useState<"public" | "private">("public");
  return (
    <AppShell>
      <TopBar />
      <div className="px-4 pt-3 pb-6">
        <h1 className="font-display text-2xl font-bold">{t("upload.title")}</h1>

        <div className="mt-4 rounded-3xl border-2 border-dashed border-border bg-card/40 p-6 text-center">
          <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm font-semibold">Drag or tap to upload</p>
          <p className="text-xs text-muted-foreground">MP4, MOV, WAV, MP3 · up to 512MB</p>
          <button className="mt-3 rounded-full gradient-neon px-5 py-2 text-xs font-bold text-white glow-pink">Choose file</button>
        </div>

        <p className="mt-5 mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t("upload.pickType")}</p>
        <div className="grid grid-cols-4 gap-2">
          {types.map((tp) => (
            <button key={tp.key} onClick={() => setType(tp.key)}
              className={`flex flex-col items-center gap-1 rounded-2xl border p-3 text-[11px] font-semibold ${
                type === tp.key ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/60"
              }`}>
              <tp.icon className="h-4 w-4" /> {tp.label}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-3">
          <Field label={t("upload.caption")}><input className="input" placeholder="Give it a catchy title" /></Field>
          <Field label={t("upload.description")}><textarea rows={3} className="input" placeholder="Say something about your track" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("upload.category")}>
              <select className="input"><option>Pop</option><option>Hip-Hop</option><option>Electronic</option></select>
            </Field>
            <Field label={t("upload.tags")}><input className="input" placeholder="#neonpop #cover" /></Field>
          </div>

          <fieldset className="rounded-2xl border border-border bg-card/40 p-3">
            <legend className="px-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t("upload.credits")}</legend>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder={t("upload.performer")} />
              <input className="input" placeholder={t("upload.writer")} />
              <input className="input" placeholder={t("upload.composer")} />
              <input className="input" placeholder={t("upload.producer")} />
              <input className="input col-span-2" placeholder={t("upload.arranger")} />
            </div>
          </fieldset>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t("upload.visibility")}</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setV("public")}
                className={`flex items-center justify-center gap-2 rounded-2xl border p-3 text-sm font-semibold ${visibility === "public" ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/60"}`}>
                <Globe className="h-4 w-4" /> {t("upload.public")}
              </button>
              <button onClick={() => setV("private")}
                className={`flex items-center justify-center gap-2 rounded-2xl border p-3 text-sm font-semibold ${visibility === "private" ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/60"}`}>
                <Lock className="h-4 w-4" /> {t("upload.private")}
              </button>
            </div>
          </div>
        </div>

        <button className="mt-6 w-full rounded-full gradient-neon py-3 text-sm font-bold text-white glow-pink">
          {t("common.publish")}
        </button>
      </div>

      <style>{`.input { width: 100%; border-radius: 12px; background: var(--color-input); padding: 10px 12px; font-size: 14px; outline: none; border: 1px solid var(--color-border); }
      .input:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-primary) 25%, transparent); }`}</style>
    </AppShell>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
