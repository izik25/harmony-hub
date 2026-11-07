import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Trophy, Users } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { PostCoverBg } from "@/components/PostCoverBg";
import { Segmented } from "@/components/Segmented";
import { listCompetitions } from "@/functions/competitions";

export const Route = createFileRoute("/competitions")({
  component: CompetitionsPage,
});

const staggerClasses = [
  "stagger-1",
  "stagger-2",
  "stagger-3",
  "stagger-4",
  "stagger-5",
  "stagger-6",
];

function CompetitionsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"active" | "upcoming" | "finished">("active");
  const { data: competitions } = useQuery({
    queryKey: ["competitions", tab],
    queryFn: () => listCompetitions({ data: { status: tab } }),
  });

  const featured = competitions?.[0];
  const rest = competitions?.slice(1) ?? [];

  return (
    <AppShell width="wide">
      <TopBar />
      <div className="px-4 pb-8 pt-6">
        <h1 className="page-title">{t("comp.title")}</h1>

        <Segmented
          className="mt-5 lg:max-w-md"
          ariaLabel={t("comp.title")}
          value={tab}
          onChange={setTab}
          options={(["active", "upcoming", "finished"] as const).map((k) => ({
            value: k,
            label: t(`comp.${k}`),
          }))}
        />

        {competitions && !featured && (
          <div className="mt-10 flex flex-col items-center text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-muted text-brand-gold">
              <Trophy className="h-6 w-6" />
            </span>
            <p className="mt-4 text-sm text-muted-foreground">
              {t("comp.noneRightNow", { status: t(`comp.${tab}`) })}
            </p>
          </div>
        )}

        {featured && (
          <Link
            to="/competitions/$id"
            params={{ id: featured.id }}
            className="group mt-6 block outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-[22px]"
          >
            {/* A poster, not a card: the prize is the headline number, read like a meter. */}
            <article className="relative isolate flex min-h-64 flex-col justify-end overflow-hidden rounded-[22px] border border-border p-5 animate-fade-up lg:min-h-72 lg:p-7">
              <div className="absolute inset-0 -z-10 transition-transform duration-700 ease-(--ease-snappy) group-hover:scale-[1.03]">
                <PostCoverBg hue={featured.hue} seed={featured.coverSeed} />
              </div>
              <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/90 via-black/45 to-black/10" />
              <span className="self-start rounded-md bg-white/12 px-2 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                {t(`comp.${featured.stage}`)}
              </span>
              <h2 className="bidi-auto mt-3 text-2xl text-white lg:text-3xl">{featured.title}</h2>
              <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                <div className="flex items-end gap-6">
                  <div>
                    <p className="text-xs text-white/70">{t("comp.prize")}</p>
                    <p className="font-numeric text-2xl font-bold text-brand-gold lg:text-3xl">
                      {featured.prize}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-white/70">
                      <Users className="me-1 inline h-3.5 w-3.5 align-[-2px]" />
                      {t("comp.entriesCount", { n: featured.participants })}
                    </p>
                  </div>
                </div>
                <span
                  className={`inline-flex h-11 items-center rounded-xl px-5 text-sm font-bold ${
                    featured.status === "active"
                      ? "bg-brand-coral text-white shadow-pop-coral"
                      : "bg-white/12 text-white"
                  }`}
                >
                  {featured.status === "active"
                    ? t("comp.join")
                    : t(featured.status === "upcoming" ? "comp.openingSoon" : "comp.closed")}
                </span>
              </div>
            </article>
          </Link>
        )}

        {rest.length > 0 && (
          <ul className="list-group mt-4 lg:grid lg:grid-cols-2 lg:[&>*+*]:border-t-0 lg:[&>*]:border-b lg:[&>*:nth-child(odd)]:border-e">
            {rest.map((c, i) => (
              <li key={c.id} className={`animate-fade-up ${staggerClasses[i % 6]}`}>
                <Link
                  to="/competitions/$id"
                  params={{ id: c.id }}
                  className="flex items-center gap-4 px-4 py-3.5 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="bidi-auto truncate font-semibold">{c.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t(`comp.${c.stage}`)} · {t("comp.entriesCount", { n: c.participants })}
                    </p>
                  </div>
                  <span className="font-numeric text-sm font-bold text-brand-gold">{c.prize}</span>
                  <span
                    className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${
                      c.status === "active"
                        ? "bg-brand-coral/15 text-brand-coral"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {c.status === "active"
                      ? t("common.vote")
                      : t(c.status === "upcoming" ? "comp.openingSoon" : "comp.closed")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
