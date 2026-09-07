import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "framer-motion";
import { Music2, Sparkles, Music4, Waves } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { GoogleAuthButton } from "@/components/GoogleAuthButton";
import { PhoneAuthForm } from "@/components/PhoneAuthForm";
import { getAuthProviders, signup, type SessionUser } from "@/functions/auth";
import { translateServerError } from "@/lib/i18n";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

const AMBIENT_ICONS = [Music2, Sparkles, Music4, Waves] as const;

function AmbientNotes({ count = 5 }: { count?: number }) {
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
          className="absolute bottom-0 text-primary/40"
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

function SignupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [method, setMethod] = useState<"email" | "phone">("email");

  const { data: providers } = useQuery({
    queryKey: ["authProviders"],
    queryFn: () => getAuthProviders(),
  });

  const onAuthed = (user: SessionUser) => {
    queryClient.setQueryData(["currentUser"], user);
    navigate({ to: "/" });
  };

  const mutation = useMutation({
    mutationFn: () => signup({ data: { handle, name, email, password } }),
    onSuccess: onAuthed,
  });

  return (
    <AppShell hideNav>
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-10">
        {!reduceMotion && <AmbientNotes />}

        <div className="relative z-10 flex w-full flex-col items-center">
          <h1 className="sr-only">Studio26</h1>
          <img
            src="/brand/logo-wordmark.png"
            alt="Studio26"
            className="animate-fade-up w-full max-w-[260px] rounded-2xl bg-black p-4 shadow-pop-lg"
          />
          <p className="mt-1 text-sm text-muted-foreground">{t("auth.welcome")}</p>

          <div className="mt-8 w-full max-w-sm space-y-3">
            <h2 className="animate-fade-up stagger-1 text-center font-display text-xl font-bold">
              {t("auth.signupTitle")}
            </h2>

            {providers?.google && (
              <div className="animate-fade-up stagger-2">
                <GoogleAuthButton returnTo="/" />
              </div>
            )}

            {providers?.google && providers?.phone && (
              <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                {t("auth.orDivider")}
                <span className="h-px flex-1 bg-border" />
              </div>
            )}

            {providers?.phone && (
              <div className="flex rounded-full bg-input p-1 text-sm font-semibold">
                <button
                  type="button"
                  onClick={() => setMethod("email")}
                  className={`flex-1 rounded-full py-2 transition ${method === "email" ? "bg-brand-coral text-white shadow-pop-coral" : "text-muted-foreground"}`}
                >
                  {t("auth.methodEmail")}
                </button>
                <button
                  type="button"
                  onClick={() => setMethod("phone")}
                  className={`flex-1 rounded-full py-2 transition ${method === "phone" ? "bg-brand-coral text-white shadow-pop-coral" : "text-muted-foreground"}`}
                >
                  {t("auth.methodPhone")}
                </button>
              </div>
            )}

            {method === "phone" && providers?.phone ? (
              <PhoneAuthForm onSuccess={onAuthed} />
            ) : (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  mutation.mutate();
                }}
              >
                <input
                  className="input animate-fade-up stagger-2"
                  placeholder={t("auth.name")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                />
                <input
                  className="input animate-fade-up stagger-3"
                  placeholder={t("auth.handle")}
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  autoComplete="username"
                  required
                />
                <input
                  className="input animate-fade-up stagger-4"
                  type="email"
                  placeholder={t("auth.email")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
                <input
                  className="input animate-fade-up stagger-5"
                  type="password"
                  placeholder={t("auth.password")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={6}
                />

                {mutation.isError && (
                  <p className="text-sm text-primary">
                    {translateServerError((mutation.error as Error).message)}
                  </p>
                )}

                <motion.button
                  type="submit"
                  disabled={mutation.isPending}
                  whileTap={mutation.isPending ? undefined : { scale: 0.97 }}
                  whileHover={mutation.isPending ? undefined : { scale: 1.02, y: -1 }}
                  transition={{ type: "spring", stiffness: 450, damping: 28 }}
                  className="animate-fade-up stagger-6 w-full rounded-full bg-brand-coral py-3 text-sm font-bold text-white shadow-pop-coral disabled:opacity-60"
                >
                  {mutation.isPending ? "…" : t("auth.signupCta")}
                </motion.button>
              </form>
            )}
          </div>

          <p className="mt-6 text-sm text-muted-foreground">
            {t("auth.haveAccount")}{" "}
            <Link to="/login" className="font-semibold text-accent">
              {t("auth.logIn")}
            </Link>
          </p>
        </div>
      </div>

      <style>{`.input { width: 100%; border-radius: 9999px; background: var(--color-input); padding: 12px 16px; font-size: 14px; outline: none; border: 1px solid var(--color-border); }
      .input:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-primary) 25%, transparent); }`}</style>
    </AppShell>
  );
}
