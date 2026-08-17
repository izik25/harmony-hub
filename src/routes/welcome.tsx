import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  BadgeCheck,
  Gift,
  Globe2,
  Heart,
  MessageCircle,
  Mic2,
  Music2,
  Play,
  Radio,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { setLanguage } from "@/lib/i18n";
import { PostCoverBg } from "@/components/PostCoverBg";

export const Route = createFileRoute("/welcome")({
  component: WelcomePage,
});

const LANGS = [
  { code: "en", label: "EN" },
  { code: "he", label: "עב" },
  { code: "ar", label: "عر" },
];

const FEATURE_ICONS = {
  feed: Music2,
  karaoke: Mic2,
  studio: SlidersHorizontal,
  competitions: Trophy,
  wallet: Gift,
  messages: MessageCircle,
  labelHub: Users,
  publish: Share2,
  languages: Globe2,
  live: Radio,
} as const;

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0 },
};

function WelcomePage() {
  const { t, i18n } = useTranslation();

  const featureKeys = Object.keys(FEATURE_ICONS) as (keyof typeof FEATURE_ICONS)[];
  const steps = ["step1", "step2", "step3"] as const;

  return (
    <div className="relative min-h-screen overflow-x-clip bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-80"
        style={{ background: "var(--gradient-glow)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -right-40 top-[38vh] -z-10 h-[520px] w-[520px] rounded-full opacity-25 blur-[120px]"
        style={{ background: "var(--neon-purple)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -left-40 top-[2vh] -z-10 h-[420px] w-[420px] rounded-full opacity-20 blur-[120px]"
        style={{ background: "var(--neon-cyan)" }}
      />

      {/* header */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-8">
          <span className="font-display text-2xl font-bold gradient-neon-text">SONA</span>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-0.5 rounded-full border border-border/60 p-0.5 sm:flex">
              {LANGS.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setLanguage(l.code)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    i18n.language?.startsWith(l.code)
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <Link
              to="/login"
              className="rounded-full px-4 py-2 text-sm font-semibold text-foreground/85 hover:text-foreground"
            >
              {t("landing.nav.login")}
            </Link>
            <Link
              to="/signup"
              className="rounded-full gradient-neon px-4 py-2 text-sm font-bold text-white glow-pink"
            >
              {t("landing.nav.signup")}
            </Link>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:px-8 sm:pb-24 sm:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              {t("landing.hero.kicker")}
            </span>

            <h1 className="mt-5 font-display text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
              <span className="gradient-neon-text">{t("landing.hero.title")}</span>
            </h1>

            <p className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
              {t("landing.hero.subtitle")}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/signup"
                className="group inline-flex items-center gap-2 rounded-full gradient-neon px-7 py-3.5 text-sm font-bold text-white glow-pink transition-transform hover:scale-[1.03]"
              >
                {t("landing.hero.ctaPrimary")}
                <ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </Link>
              <Link
                to="/login"
                className="rounded-full border border-border px-7 py-3.5 text-sm font-semibold text-foreground/90 transition-colors hover:border-primary/60 hover:text-primary"
              >
                {t("landing.hero.ctaSecondary")}
              </Link>
            </div>

            <p className="mt-6 text-xs font-medium tracking-wide text-muted-foreground/80">
              {t("landing.hero.trust")}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.92, rotate: -2 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 0.7, ease: "easeOut", delay: 0.15 }}
            className="relative mx-auto w-full max-w-[280px]"
          >
            <div className="absolute inset-0 -z-10 scale-95 rounded-[2.5rem] gradient-neon opacity-40 blur-2xl" />
            <div className="relative aspect-[9/17.5] w-full overflow-hidden rounded-[2.5rem] border border-white/10 shadow-2xl">
              <PostCoverBg hue={162} seed="landing-hero" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/40" />

              <div className="absolute right-3 top-1/2 flex -translate-y-1/2 flex-col items-center gap-5">
                {[
                  { Icon: Heart, value: "48.2K" },
                  { Icon: MessageCircle, value: "1,204" },
                  { Icon: Gift, value: "962" },
                  { Icon: Share2, value: "310" },
                ].map(({ Icon, value }, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-white/10 backdrop-blur-md">
                      <Icon className="h-5 w-5 text-white" />
                    </span>
                    <span className="text-[10px] font-semibold text-white/90">{value}</span>
                  </div>
                ))}
              </div>

              <div className="absolute inset-x-4 bottom-4 flex items-center gap-2">
                <span className="grid h-11 w-11 shrink-0 animate-spin-slow place-items-center rounded-full border-2 border-white/70 bg-black/30">
                  <Music2 className="h-4 w-4 text-white" />
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-1 truncate text-sm font-bold text-white">
                    Nova Ray <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
                  </p>
                  <p className="truncate text-xs text-white/75">Midnight Echo — Original</p>
                </div>
              </div>

              <span className="absolute left-1/2 top-1/2 grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/15 backdrop-blur-md">
                <Play className="h-6 w-6 fill-white text-white" />
              </span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* features */}
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={fadeUp}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-2xl text-center"
        >
          <span className="text-xs font-bold uppercase tracking-widest text-primary">
            {t("landing.features.kicker")}
          </span>
          <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">
            {t("landing.features.title")}
          </h2>
          <p className="mt-3 text-muted-foreground">{t("landing.features.subtitle")}</p>
        </motion.div>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featureKeys.map((key, i) => {
            const Icon = FEATURE_ICONS[key];
            const isLive = key === "live";
            return (
              <motion.div
                key={key}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.3 }}
                variants={fadeUp}
                transition={{ duration: 0.45, delay: (i % 3) * 0.08 }}
                className="group relative overflow-hidden rounded-3xl border border-border/60 bg-card/50 p-6 transition-colors hover:border-primary/50"
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-40"
                  style={{ background: "var(--gradient-neon)" }}
                />
                <div className="relative flex items-start justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl gradient-neon glow-pink">
                    <Icon className="h-5 w-5 text-white" />
                  </span>
                  {isLive && (
                    <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-[10px] font-bold text-accent">
                      {t("landing.features.live.badge")}
                    </span>
                  )}
                </div>
                <h3 className="relative mt-4 font-display text-lg font-bold">
                  {t(`landing.features.${key}.title`)}
                </h3>
                <p className="relative mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(`landing.features.${key}.desc`)}
                </p>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* how it works */}
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={fadeUp}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-2xl text-center"
        >
          <span className="text-xs font-bold uppercase tracking-widest text-primary">
            {t("landing.howItWorks.kicker")}
          </span>
          <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">
            {t("landing.howItWorks.title")}
          </h2>
        </motion.div>

        <div className="relative mt-14 grid grid-cols-1 gap-8 sm:grid-cols-3">
          <div
            aria-hidden
            className="absolute inset-x-0 top-6 hidden h-px bg-gradient-to-r from-transparent via-border to-transparent sm:block"
          />
          {steps.map((step, i) => (
            <motion.div
              key={step}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.4 }}
              variants={fadeUp}
              transition={{ duration: 0.45, delay: i * 0.12 }}
              className="relative text-center sm:text-start"
            >
              <span className="relative z-10 mx-auto flex h-12 w-12 items-center justify-center rounded-full gradient-neon font-display text-lg font-bold text-white glow-cyan sm:mx-0">
                {i + 1}
              </span>
              <h3 className="mt-4 font-display text-xl font-bold">
                {t(`landing.howItWorks.${step}.title`)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t(`landing.howItWorks.${step}.desc`)}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* final CTA */}
      <section className="mx-auto max-w-6xl px-5 pb-20 sm:px-8 sm:pb-28">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.4 }}
          variants={fadeUp}
          transition={{ duration: 0.5 }}
          className="relative overflow-hidden rounded-[2rem] border border-border/60 bg-card/60 px-6 py-14 text-center sm:px-16"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{ background: "var(--gradient-neon)" }}
          />
          <div className="relative">
            <h2 className="mx-auto max-w-xl font-display text-3xl font-bold sm:text-4xl">
              {t("landing.cta.title")}
            </h2>
            <p className="mx-auto mt-3 max-w-md text-muted-foreground">{t("landing.cta.subtitle")}</p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <Link
                to="/signup"
                className="inline-flex items-center gap-2 rounded-full gradient-neon px-8 py-3.5 text-sm font-bold text-white glow-pink transition-transform hover:scale-[1.03]"
              >
                {t("landing.cta.button")}
                <ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </Link>
            </div>
            <Link
              to="/login"
              className="mt-5 inline-block text-sm font-medium text-muted-foreground hover:text-primary"
            >
              {t("landing.cta.loginHint")}
            </Link>
          </div>
        </motion.div>
      </section>

      {/* footer */}
      <footer className="border-t border-border/60 px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="font-display text-lg font-bold gradient-neon-text">SONA</span>
            <span className="text-xs text-muted-foreground">{t("landing.footer.tagline")}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("landing.footer.rights", { year: new Date().getFullYear() })}
          </p>
        </div>
      </footer>
    </div>
  );
}
