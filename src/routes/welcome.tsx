import { createFileRoute, Link } from "@tanstack/react-router";
import {
  animate,
  motion,
  useInView,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  BadgeCheck,
  Disc3,
  Gift,
  Globe2,
  Headphones,
  Heart,
  MessageCircle,
  Mic2,
  Music2,
  Music4,
  Play,
  Radio,
  Share2,
  Sparkles,
  SlidersHorizontal,
  Trophy,
  Users,
  Waves,
} from "lucide-react";
import { isRTL, setLanguage } from "@/lib/i18n";
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
  hidden: { opacity: 0, y: 34, scale: 0.97, filter: "blur(6px)" },
  visible: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" },
};

function WelcomePage() {
  const { t, i18n } = useTranslation();
  const rtl = isRTL(i18n.language);
  const reduceMotion = useReducedMotion();

  const featureKeys = Object.keys(FEATURE_ICONS) as (keyof typeof FEATURE_ICONS)[];
  const steps = ["step1", "step2", "step3"] as const;
  const marqueeItems = t("landing.marquee").split(" • ");

  const { scrollYProgress } = useScroll();
  const parallax1 = useTransform(scrollYProgress, [0, 1], [0, -120]);
  const parallax2 = useTransform(scrollYProgress, [0, 1], [0, -220]);
  const parallax3 = useTransform(scrollYProgress, [0, 1], [0, -80]);
  const parallax4 = useTransform(scrollYProgress, [0, 1], [0, -170]);
  const headerShadow = useTransform(
    scrollYProgress,
    [0, 0.03],
    ["0 1px 0 0 transparent", "0 1px 0 0 var(--color-border)"],
  );

  const heroMX = useMotionValue(50);
  const heroMY = useMotionValue(50);
  const heroSpotlight = useMotionTemplate`radial-gradient(650px circle at ${heroMX}% ${heroMY}%, color-mix(in oklab, var(--color-primary) 14%, transparent), transparent 60%)`;
  const handleHeroMove = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    heroMX.set(((e.clientX - rect.left) / rect.width) * 100);
    heroMY.set(((e.clientY - rect.top) / rect.height) * 100);
  };

  const tiltX = useMotionValue(0);
  const tiltY = useMotionValue(0);
  const springTiltX = useSpring(tiltX, { stiffness: 150, damping: 14 });
  const springTiltY = useSpring(tiltY, { stiffness: 150, damping: 14 });
  const handlePhoneMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    tiltY.set(px * 16 * (rtl ? -1 : 1));
    tiltX.set(py * -16);
  };
  const resetTilt = () => {
    tiltX.set(0);
    tiltY.set(0);
  };

  const stepsRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress: stepsProgress } = useScroll({
    target: stepsRef,
    offset: ["start 85%", "end 65%"],
  });

  const titleContainer = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } },
  };
  const titleWord = {
    hidden: { opacity: 0, y: 22, filter: "blur(6px)" },
    visible: { opacity: 1, y: 0, filter: "blur(0px)" },
  };

  return (
    <div className="relative min-h-screen overflow-x-clip bg-background text-foreground">
      {/* scroll progress */}
      <motion.div
        aria-hidden
        className="fixed inset-x-0 top-0 z-50 h-[3px] gradient-neon"
        style={{ scaleX: scrollYProgress, transformOrigin: rtl ? "100% 0%" : "0% 0%" }}
      />

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
      <motion.header
        style={{ boxShadow: headerShadow }}
        className="sticky top-0 z-30 bg-background/70 backdrop-blur-xl"
      >
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
      </motion.header>

      {/* hero */}
      <section
        onMouseMove={handleHeroMove}
        className="relative mx-auto max-w-6xl overflow-clip px-5 pb-16 pt-14 sm:px-8 sm:pb-24 sm:pt-20"
      >
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0"
          style={{ background: heroSpotlight }}
        />

        {!reduceMotion && (
          <>
            <FloatingIcon
              Icon={Headphones}
              top="6%"
              left="3%"
              size={26}
              delay={0}
              parallaxY={parallax1}
            />
            <FloatingIcon
              Icon={Disc3}
              top="14%"
              left="90%"
              size={30}
              delay={0.4}
              parallaxY={parallax2}
            />
            <FloatingIcon
              Icon={Music4}
              top="72%"
              left="6%"
              size={22}
              delay={0.8}
              parallaxY={parallax3}
            />
            <FloatingIcon
              Icon={Waves}
              top="80%"
              left="84%"
              size={24}
              delay={1.2}
              parallaxY={parallax4}
            />
          </>
        )}

        <div className="relative z-10 grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              {t("landing.hero.kicker")}
              <EqualizerBars count={5} className="ms-1" />
            </span>

            <motion.h1
              initial="hidden"
              animate="visible"
              variants={titleContainer}
              className="mt-5 font-display text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl"
            >
              {t("landing.hero.title")
                .split(" ")
                .map((word, i) => (
                  <motion.span
                    key={i}
                    variants={titleWord}
                    transition={{ duration: 0.55, ease: "easeOut" }}
                    className="shimmer-text gradient-neon-text me-3 inline-block"
                  >
                    {word}
                  </motion.span>
                ))}
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.5 }}
              className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg"
            >
              {t("landing.hero.subtitle")}
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.65 }}
              className="mt-8 flex flex-wrap items-center gap-3"
            >
              <Magnetic>
                <Link
                  to="/signup"
                  className="group inline-flex items-center gap-2 rounded-full gradient-neon px-7 py-3.5 text-sm font-bold text-white glow-pink"
                >
                  {t("landing.hero.ctaPrimary")}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
                </Link>
              </Magnetic>
              <Link
                to="/login"
                className="rounded-full border border-border px-7 py-3.5 text-sm font-semibold text-foreground/90 transition-colors hover:border-primary/60 hover:text-primary"
              >
                {t("landing.hero.ctaSecondary")}
              </Link>
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.85 }}
              className="mt-6 text-xs font-medium tracking-wide text-muted-foreground/80"
            >
              {t("landing.hero.trust")}
            </motion.p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, ease: "easeOut", delay: 0.2 }}
            className="relative mx-auto w-full max-w-[280px]"
            style={{ perspective: 1200 }}
          >
            <motion.div
              aria-hidden
              animate={reduceMotion ? undefined : { opacity: [0.3, 0.55, 0.3] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
              className="absolute inset-0 -z-10 scale-95 rounded-[2.5rem] gradient-neon opacity-40 blur-2xl"
            />
            <motion.div
              onMouseMove={handlePhoneMove}
              onMouseLeave={resetTilt}
              style={{
                rotateX: springTiltX,
                rotateY: springTiltY,
                transformStyle: "preserve-3d",
              }}
              className="relative aspect-[9/17.5] w-full overflow-hidden rounded-[2.5rem] border border-white/10 shadow-2xl"
            >
              <PostCoverBg hue={162} seed="landing-hero" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/40" />

              <div className="absolute end-3 top-1/2 flex -translate-y-1/2 flex-col items-center gap-5">
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
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* marquee */}
      <div className="marquee-mask relative overflow-hidden border-y border-border/50 py-4">
        <div className="marquee-track flex w-max items-center gap-10">
          {[...marqueeItems, ...marqueeItems].map((item, i) => (
            <span
              key={i}
              className="flex items-center gap-3 whitespace-nowrap font-display text-lg font-semibold text-muted-foreground/70"
            >
              {item}
              <span className="h-1.5 w-1.5 rounded-full bg-primary/60" />
            </span>
          ))}
        </div>
      </div>

      {/* stats */}
      <section className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {[
            { Icon: Globe2, value: 3, suffix: "", label: t("landing.stats.languages") },
            { Icon: Sparkles, value: 10, suffix: "+", label: t("landing.stats.features") },
            { Icon: SlidersHorizontal, value: 100, suffix: "%", label: t("landing.stats.dsp") },
          ].map(({ Icon, value, suffix, label }, i) => (
            <motion.div
              key={i}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.5 }}
              variants={fadeUp}
              transition={{ duration: 0.45, delay: i * 0.08 }}
              className="flex items-center gap-4 rounded-2xl border border-border/60 bg-card/40 p-5"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl gradient-neon">
                <Icon className="h-5 w-5 text-white" />
              </span>
              <div>
                <p className="font-display text-2xl font-bold gradient-neon-text">
                  <CountUp value={value} suffix={suffix} />
                </p>
                <p className="text-sm text-muted-foreground">{label}</p>
              </div>
            </motion.div>
          ))}
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
              >
                <SpotlightCard>
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
                </SpotlightCard>
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

        <div ref={stepsRef} className="relative mt-14 grid grid-cols-1 gap-8 sm:grid-cols-3">
          <div aria-hidden className="absolute inset-x-0 top-6 hidden h-px bg-border sm:block" />
          <motion.div
            aria-hidden
            className="absolute inset-x-0 top-6 hidden h-px gradient-neon sm:block"
            style={{ scaleX: stepsProgress, transformOrigin: rtl ? "100% 0%" : "0% 0%" }}
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
          <motion.div
            aria-hidden
            animate={reduceMotion ? undefined : { opacity: [0.22, 0.4, 0.22] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            className="pointer-events-none absolute inset-0"
            style={{ background: "var(--gradient-neon)" }}
          />
          <div className="relative">
            <h2 className="mx-auto max-w-xl font-display text-3xl font-bold sm:text-4xl">
              {t("landing.cta.title")}
            </h2>
            <p className="mx-auto mt-3 max-w-md text-muted-foreground">
              {t("landing.cta.subtitle")}
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <Magnetic>
                <Link
                  to="/signup"
                  className="inline-flex items-center gap-2 rounded-full gradient-neon px-8 py-3.5 text-sm font-bold text-white glow-pink"
                >
                  {t("landing.cta.button")}
                  <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                </Link>
              </Magnetic>
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

      <style>{`
        .shimmer-text {
          background-size: 220% auto;
          animation: shimmer-move 5s ease-in-out infinite;
        }
        @keyframes shimmer-move {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .marquee-mask {
          -webkit-mask-image: linear-gradient(90deg, transparent, black 8%, black 92%, transparent);
          mask-image: linear-gradient(90deg, transparent, black 8%, black 92%, transparent);
        }
        .marquee-track { animation: marquee-scroll 28s linear infinite; }
        @keyframes marquee-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .eq-bar {
          height: 5px;
          animation: eq-bounce ease-in-out infinite;
        }
        @keyframes eq-bounce {
          0%, 100% { height: 4px; opacity: .5; }
          50% { height: 14px; opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .shimmer-text { animation: none; }
          .marquee-track { animation: none; }
          .eq-bar { animation: none; height: 9px; }
        }
      `}</style>
    </div>
  );
}

function FloatingIcon({
  Icon,
  top,
  left,
  size = 24,
  delay = 0,
  parallaxY,
}: {
  Icon: typeof Music2;
  top: string;
  left: string;
  size?: number;
  delay?: number;
  parallaxY: MotionValue<number>;
}) {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute z-0 hidden sm:block"
      style={{ top, left, y: parallaxY }}
    >
      <motion.div
        animate={{ y: [0, -14, 0], rotate: [0, 6, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay }}
        className="grid place-items-center rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-md"
      >
        <Icon style={{ width: size, height: size }} className="text-primary/70" />
      </motion.div>
    </motion.div>
  );
}

function EqualizerBars({ count = 5, className = "" }: { count?: number; className?: string }) {
  return (
    <span className={`inline-flex items-end gap-[2px] ${className}`} aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="eq-bar w-[2.5px] rounded-full gradient-neon"
          style={{
            animationDelay: `${(i % count) * 0.14}s`,
            animationDuration: `${0.8 + (i % 4) * 0.15}s`,
          }}
        />
      ))}
    </span>
  );
}

function Magnetic({ children, strength = 0.3 }: { children: ReactNode; strength?: number }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 300, damping: 20, mass: 0.5 });
  const springY = useSpring(y, { stiffness: 300, damping: 20, mass: 0.5 });

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - rect.left - rect.width / 2) * strength);
    y.set((e.clientY - rect.top - rect.height / 2) * strength);
  };
  const reset = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      onMouseMove={handleMove}
      onMouseLeave={reset}
      style={{ x: springX, y: springY }}
      className="inline-block"
    >
      {children}
    </motion.div>
  );
}

function SpotlightCard({ children }: { children: ReactNode }) {
  const mx = useMotionValue(50);
  const my = useMotionValue(50);
  const spotlight = useMotionTemplate`radial-gradient(240px circle at ${mx}% ${my}%, color-mix(in oklab, var(--color-primary) 20%, transparent), transparent 70%)`;

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mx.set(((e.clientX - rect.left) / rect.width) * 100);
    my.set(((e.clientY - rect.top) / rect.height) * 100);
  };

  return (
    <div
      onMouseMove={handleMove}
      className="group relative h-full overflow-hidden rounded-3xl border border-border/60 bg-card/50 p-6 transition-colors hover:border-primary/50"
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: spotlight }}
      />
      {children}
    </div>
  );
}

function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.6 });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!isInView) return;
    const controls = animate(0, value, {
      duration: 1.3,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [isInView, value]);

  return (
    <span ref={ref}>
      {display}
      {suffix}
    </span>
  );
}
