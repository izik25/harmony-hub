import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, TrendingUp, Flame, BadgeCheck } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { PostCoverBg } from "@/components/PostCoverBg";
import { genres, formatCount } from "@/lib/mock-data";
import { searchAll, trendingTags, listPostsByType } from "@/functions/search";

export const Route = createFileRoute("/explore")({
  component: ExplorePage,
});

const tabs = ["artists", "songs", "djs", "producers", "genres"] as const;

function ExplorePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<(typeof tabs)[number]>("artists");
  const [query, setQuery] = useState("");
  const hasQuery = query.trim().length > 0;

  const { data: tags } = useQuery({ queryKey: ["trendingTags"], queryFn: () => trendingTags() });
  const { data: topPosts } = useQuery({
    queryKey: ["topPosts"],
    queryFn: () => listPostsByType({ data: {} }),
    enabled: !hasQuery,
  });
  const { data: results } = useQuery({
    queryKey: ["search", query],
    queryFn: () => searchAll({ data: { query } }),
    enabled: hasQuery,
  });

  const songResults =
    results?.posts.filter((p) => p.type === "original" || p.type === "cover") ?? [];
  const djResults = results?.posts.filter((p) => p.type === "djset") ?? [];

  return (
    <AppShell>
      <TopBar />
      <div className="px-4 pt-3">
        <label className="flex items-center gap-2 rounded-full bg-muted/60 px-4 py-3 ring-1 ring-border">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("explore.search")}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>

        <div className="mt-4 flex items-center gap-2 overflow-x-auto no-scrollbar">
          {tabs.map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                tab === k
                  ? "gradient-neon text-white glow-pink"
                  : "border border-border bg-card/60 text-muted-foreground"
              }`}
            >
              {t(`explore.${k}`)}
            </button>
          ))}
        </div>

        {!hasQuery && (
          <>
            <div className="mt-5 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
              <Flame className="h-3.5 w-3.5 text-primary" /> {t("common.trending")}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {tags?.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setQuery(tag.replace("#", ""))}
                  className="rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-foreground/80"
                >
                  {tag}
                </button>
              ))}
              {tags?.length === 0 && (
                <span className="text-xs text-muted-foreground">{t("explore.noTrendingYet")}</span>
              )}
            </div>

            <div className="mt-6 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5 text-accent" /> {t("common.top")}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {topPosts?.map((p) => (
                <article
                  key={p.id}
                  className="group relative aspect-[3/4] overflow-hidden rounded-2xl"
                >
                  <PostCoverBg hue={p.hue} seed={p.id} imageUrl={p.coverUrl} />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-3">
                    <p className="line-clamp-1 text-sm font-semibold text-white">{p.title}</p>
                    <p className="text-[11px] text-white/70">{formatCount(p.likesCount)} ❤</p>
                  </div>
                </article>
              ))}
            </div>

            <div className="mt-6 mb-8">
              <h3 className="mb-2 font-display text-lg font-bold">{t("explore.genres")}</h3>
              <div className="grid grid-cols-2 gap-2">
                {genres.map((g, i) => (
                  <div
                    key={g}
                    className="rounded-xl p-3 text-sm font-semibold text-white"
                    style={{
                      background: `linear-gradient(135deg, hsl(${(i * 40) % 360} 85% 55%), hsl(${(i * 40 + 60) % 360} 90% 45%))`,
                    }}
                  >
                    {g}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {hasQuery && (
          <div className="mt-5 mb-8">
            {(tab === "artists" || tab === "producers") && (
              <ul className="space-y-2">
                {results?.users.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t("explore.noMatchingArtists")}</p>
                )}
                {results?.users.map((u) => (
                  <li key={u.id}>
                    <Link
                      to="/profile/$handle"
                      params={{ handle: u.handle }}
                      className="flex items-center gap-3 rounded-2xl border border-border bg-card/60 p-3"
                    >
                      <img src={u.avatarUrl} className="h-10 w-10 rounded-full" alt="" />
                      <span className="flex items-center gap-1 text-sm font-semibold">
                        {u.name} {u.verified && <BadgeCheck className="h-4 w-4 text-accent" />}
                      </span>
                      <span className="text-xs text-muted-foreground">@{u.handle}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {(tab === "songs" || tab === "djs") && (
              <div className="grid grid-cols-2 gap-3">
                {(tab === "songs" ? songResults : djResults).length === 0 && (
                  <p className="col-span-2 text-sm text-muted-foreground">
                    {t("explore.noMatchingTracks")}
                  </p>
                )}
                {(tab === "songs" ? songResults : djResults).map((p) => (
                  <article key={p.id} className="relative aspect-[3/4] overflow-hidden rounded-2xl">
                    <PostCoverBg hue={p.hue} seed={p.id} imageUrl={p.coverUrl} />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-3">
                      <p className="line-clamp-1 text-sm font-semibold text-white">{p.title}</p>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {tab === "genres" && (
              <div className="grid grid-cols-2 gap-2">
                {genres
                  .filter((g) => g.toLowerCase().includes(query.toLowerCase()))
                  .map((g, i) => (
                    <div
                      key={g}
                      className="rounded-xl p-3 text-sm font-semibold text-white"
                      style={{
                        background: `linear-gradient(135deg, hsl(${(i * 40) % 360} 85% 55%), hsl(${(i * 40 + 60) % 360} 90% 45%))`,
                      }}
                    >
                      {g}
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
