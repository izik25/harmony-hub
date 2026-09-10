import { createFileRoute, Link } from "@tanstack/react-router";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  BadgeCheck,
  Disc3,
  Gift,
  Headphones,
  Heart,
  MessageCircle,
  Music2,
  Music4,
  Play,
  Share2,
  Sparkles,
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

const PREVIEW_CARDS = [
  { hue: 27, seed: "welcome-1" },
  { hue: 210, seed: "welcome-2" },
  { hue: 320, seed: "welcome-3" },
  { hue: 93, seed: "welcome-4" },
  { hue: 160, seed: "welcome-5" },
  { hue: 265, seed: "welcome-6" },
];

const fadeUp = {
  hidden: { opacity: 0, y: 34, scale: 0.97, filter: "blur(6px)" },
  visible: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" },
};

function WelcomePage() {
  const { t, i18n } = useTranslation();
  const rtl = isRTL(i18n.language);
  const reduceMotion = useReducedMotion();
  const marqueeItems = t("landing.marquee").split(" • ");

  const { scrollYProgress } = useScroll();
  const parallax1 = useTransform(scrollYProgress, [0, 1], [0, -120]);
  const parallax2 = useTransform(scrollYProgress, [0, 1], [0, -220]);
  const parallax3 = useTransform(scrollYProgress, [0, 1], [0, -80]);
  const parallax4 = useTransform(scrollYProgress, [0, 1], [0, -170]);
  const headerShadow = useTransform(
    scrollYProgress,
    [0, 0.03],
    ["0 1px 0 0 transparent", "0 1px 0 0 rgba(255,255,255,0.08)"],
  );

  const heroMX = useMotionValue(50);
  const heroMY = useMotionValue(50);
  const heroSpotlight = useMotionTemplate`radial-gradient(650px circle at ${heroMX}% ${heroMY}%, color-mix(in oklab, var(--color-primary) 18%, transparent), transparent 60%)`;
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

  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress: heroProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const phoneParallaxY = useTransform(heroProgress, [0, 1], [0, 130]);
  const phoneParallaxScale = useTransform(heroProgress, [0, 1], [1, 0.86]);
  const phoneParallaxOpacity = useTransform(heroProgress, [0, 0.85], [1, 0.25]);

  const titleContainer = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } },
  };
  const titleWord = {
    hidden: { opacity: 0, y: 22, filter: "blur(6px)" },
    visible: { opacity: 1, y: 0, filter: "blur(0px)" },
  };

  return (
    <div className="relative min-h-screen overflow-x-clip bg-black text-white">
      {/* scroll progress */}
      <motion.div
        aria-hidden
        className="fixed inset-x-0 top-0 z-50 h-[3px] bg-brand-coral"
        style={{ scaleX: scrollYProgress, transformOrigin: rtl ? "100% 0%" : "0% 0%" }}
      />

      <motion.div
        aria-hidden
        animate={reduceMotion ? undefined : { x: [0, -30, 0], y: [0, 40, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        className="pointer-events-none fixed -right-40 top-[30vh] -z-10 h-[520px] w-[520px] rounded-full bg-brand-coral opacity-[0.14] blur-[130px]"
      />
      <motion.div
        aria-hidden
        animate={reduceMotion ? undefined : { x: [0, 25, 0], y: [0, -35, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        className="pointer-events-none fixed -left-40 top-[2vh] -z-10 h-[420px] w-[420px] rounded-full bg-brand-gold opacity-[0.12] blur-[130px]"
      />

      {/* header */}
      <motion.header
        style={{ boxShadow: headerShadow }}
        className="sticky top-0 z-30 bg-black/60 backdrop-blur-xl"
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-8">
          <span className="flex items-center gap-2">
            <img src="/brand/logo-mark.png" alt="" className="h-9 w-9 rounded-xl" />
            <span className="font-display text-2xl font-bold text-brand-coral">Studio26</span>
          </span>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-0.5 rounded-full border border-white/15 p-0.5 sm:flex">
              {LANGS.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setLanguage(l.code)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    i18n.language?.startsWith(l.code)
                      ? "bg-brand-coral/25 text-brand-coral"
                      : "text-white/50 hover:text-white"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <Link
              to="/login"
              className="rounded-full px-4 py-2 text-sm font-semibold text-white/80 hover:text-white"
            >
              {t("landing.nav.login")}
            </Link>
            <Link
              to="/signup"
              className="rounded-full bg-brand-coral px-4 py-2 text-sm font-bold text-white shadow-pop-coral press-scale hover-lift"
            >
              {t("landing.nav.signup")}
            </Link>
          </div>
        </div>
      </motion.header>

      {/* hero */}
      <section
        ref={heroRef}
        onMouseMove={handleHeroMove}
        className="relative mx-auto flex min-h-[92vh] max-w-6xl flex-col justify-center overflow-clip px-5 py-14 sm:px-8"
      >
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0"
          style={{ background: heroSpotlight }}
        />

        {!reduceMotion && <AmbientNotes count={7} />}

        {!reduceMotion && (
          <>
            <FloatingIcon
              Icon={Headphones}
              top="6%"
              left="3%"
              size={22}
              delay={0}
              parallaxY={parallax1}
            />
            <FloatingIcon
              Icon={Disc3}
              top="12%"
              left="88%"
              size={26}
              delay={0.4}
              parallaxY={parallax2}
            />
            <FloatingIcon
              Icon={Music4}
              top="66%"
              left="5%"
              size={20}
              delay={0.8}
              parallaxY={parallax3}
            />
            <FloatingIcon
              Icon={Waves}
              top="74%"
              left="90%"
              size={22}
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
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70">
              <Sparkles className="h-3.5 w-3.5 text-brand-gold" />
              {t("landing.hero.kicker")}
              <EqualizerBars count={5} className="ms-1" />
            </span>

            <motion.h1
              initial="hidden"
              animate="visible"
              variants={titleContainer}
              className="mt-5 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-7xl"
            >
              {t("landing.hero.title")
                .split(" ")
                .map((word, i) => (
                  <motion.span
                    key={i}
                    variants={titleWord}
                    transition={{ duration: 0.55, ease: "easeOut" }}
                    className="text-brand-coral me-3 inline-block"
                  >
                    {word}
                  </motion.span>
                ))}
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.5 }}
              className="mt-5 max-w-md text-lg font-medium text-white/60"
            >
              {t("auth.welcome")}
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
                  className="group inline-flex items-center gap-2 rounded-full bg-brand-coral px-7 py-3.5 text-sm font-bold text-white shadow-pop-coral hover-lift"
                >
                  {t("landing.hero.ctaPrimary")}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
                </Link>
              </Magnetic>
              <Link
                to="/login"
                className="rounded-full border border-white/20 px-7 py-3.5 text-sm font-semibold text-white/90 transition-colors hover:border-brand-coral/60 hover:text-brand-coral"
              >
                {t("landing.hero.ctaSecondary")}
              </Link>
            </motion.div>
          </motion.div>

          <motion.div
            style={
              reduceMotion
                ? undefined
                : { y: phoneParallaxY, scale: phoneParallaxScale, opacity: phoneParallaxOpacity }
            }
            className="relative mx-auto w-full max-w-[280px]"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.7, ease: "easeOut", delay: 0.2 }}
              className="relative"
              style={{ perspective: 1200 }}
            >
              <motion.div
                aria-hidden
                animate={reduceMotion ? undefined : { opacity: [0.3, 0.55, 0.3] }}
                transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
                className="absolute inset-0 -z-10 scale-95 rounded-[2.5rem] bg-brand-coral opacity-30 blur-2xl"
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
                <div className="absolute inset-0 animate-cover-breathe">
                  <PostCoverBg hue={27} seed="welcome-hero" />
                </div>
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
                  <span className="grid h-11 w-11 shrink-0 animate-spin-fast place-items-center rounded-full border-2 border-white/70 bg-black/30">
                    <Music2 className="h-4 w-4 text-white" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1 truncate text-sm font-bold text-white">
                      Nova Ray <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-brand-coral" />
                    </p>
                    <p className="truncate text-xs text-white/75">Midnight Echo — Original</p>
                  </div>
                </div>

                <span className="absolute left-1/2 top-1/2 grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/15 backdrop-blur-md">
                  <Play className="h-6 w-6 fill-white text-white" />
                </span>
              </motion.div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* preview strip */}
      <section className="relative mx-auto max-w-6xl px-5 pb-14 sm:px-8">
        <div className="no-scrollbar flex gap-3 overflow-x-auto">
          {PREVIEW_CARDS.map((c, i) => (
            <motion.div
              key={c.seed}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.4 }}
              variants={fadeUp}
              whileTap={{ scale: 0.96 }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
              className="relative aspect-[9/16] w-28 shrink-0 overflow-hidden rounded-2xl border border-white/10 sm:w-36"
            >
              <PostCoverBg hue={c.hue} seed={c.seed} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/10" />
              <Play className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 fill-white/90 text-white/90" />
            </motion.div>
          ))}
        </div>
      </section>

      {/* marquee */}
      <div className="marquee-mask relative overflow-hidden border-y border-white/10 py-4">
        <div className="marquee-track flex w-max items-center gap-10">
          {[...marqueeItems, ...marqueeItems].map((item, i) => (
            <span
              key={i}
              className="flex items-center gap-3 whitespace-nowrap font-display text-lg font-semibold text-white/40"
            >
              {item}
              <span className="h-1.5 w-1.5 rounded-full bg-brand-coral/60" />
            </span>
          ))}
        </div>
      </div>

      {/* footer */}
      <footer className="px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row">
          <div className="flex items-center gap-2">
            <img src="/brand/logo-mark.png" alt="" className="h-7 w-7 rounded-lg" />
            <span className="font-display text-lg font-bold text-brand-coral">Studio26</span>
            <span className="text-xs text-white/40">{t("landing.footer.tagline")}</span>
          </div>
          <p className="text-xs text-white/40">
            {t("landing.footer.rights", { year: new Date().getFullYear() })}
          </p>
        </div>
      </footer>

      <style>{`
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
      className="pointer-events-none absolute z-0"
      style={{ top, left, y: parallaxY }}
    >
      <motion.div
        animate={{ y: [0, -14, 0], rotate: [0, 6, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay }}
        className="grid place-items-center rounded-2xl border border-white/10 bg-white/5 p-2 backdrop-blur-md sm:p-3"
      >
        <Icon style={{ width: size, height: size }} className="text-brand-coral/70" />
      </motion.div>
    </motion.div>
  );
}

const AMBIENT_ICONS = [Music2, Sparkles, Music4, Waves] as const;

function AmbientNotes({ count = 6 }: { count?: number }) {
  const notes = Array.from({ length: count }).map((_, i) => ({
    Icon: AMBIENT_ICONS[i % AMBIENT_ICONS.length],
    left: `${8 + ((i * 97) % 84)}%`,
    size: 12 + (i % 3) * 4,
    duration: 6 + (i % 4) * 1.6,
    delay: i * 0.55,
  }));
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {notes.map((n, i) => (
        <motion.span
          key={i}
          className="absolute bottom-0 text-brand-coral/40"
          style={{ left: n.left }}
          animate={{ y: ["0%", "-380%"], opacity: [0, 0.75, 0], rotate: [0, 20, -12, 0] }}
          transition={{ duration: n.duration, repeat: Infinity, ease: "easeInOut", delay: n.delay }}
        >
          <n.Icon style={{ width: n.size, height: n.size }} />
        </motion.span>
      ))}
    </div>
  );
}

function EqualizerBars({ count = 5, className = "" }: { count?: number; className?: string }) {
  return (
    <span className={`inline-flex items-end gap-[2px] ${className}`} aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={`eq-bar w-[2.5px] rounded-full ${
            ["bg-brand-coral", "bg-brand-indigo", "bg-brand-gold", "bg-brand-teal"][i % 4]
          }`}
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
      whileTap={{ scale: 0.95 }}
      style={{ x: springX, y: springY }}
      className="inline-block"
    >
      {children}
    </motion.div>
  );
}
