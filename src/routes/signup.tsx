import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { GoogleAuthButton } from "@/components/GoogleAuthButton";
import { PhoneAuthForm } from "@/components/PhoneAuthForm";
import { getAuthProviders, signup, type SessionUser } from "@/functions/auth";
import { translateServerError } from "@/lib/i18n";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

function SignupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
        <div className="relative z-10 flex w-full flex-col items-center">
          <h1 className="sr-only">Studio26</h1>
          <img
            src="/brand/logo-wordmark-alpha.png"
            alt="Studio26"
            width={701}
            height={216}
            className="animate-fade-up h-auto w-full max-w-[280px]"
          />
          <p className="mt-3 text-sm text-muted-foreground">{t("auth.welcome")}</p>

          <div className="mt-8 w-full max-w-sm space-y-3">
            <h2 className="animate-fade-up stagger-1 text-center text-2xl">
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
              <div className="flex gap-1 rounded-xl bg-[var(--surface-sunken)] p-1 text-sm font-semibold ring-1 ring-border">
                <button
                  type="button"
                  onClick={() => setMethod("email")}
                  className={`h-10 flex-1 rounded-lg transition ${method === "email" ? "bg-muted text-foreground shadow-pop ring-1 ring-[var(--hairline-strong)]" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {t("auth.methodEmail")}
                </button>
                <button
                  type="button"
                  onClick={() => setMethod("phone")}
                  className={`h-10 flex-1 rounded-lg transition ${method === "phone" ? "bg-muted text-foreground shadow-pop ring-1 ring-[var(--hairline-strong)]" : "text-muted-foreground hover:text-foreground"}`}
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
                  aria-label={t("auth.name")}
                  placeholder={t("auth.name")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                />
                <input
                  className="input animate-fade-up stagger-3"
                  aria-label={t("auth.handle")}
                  placeholder={t("auth.handle")}
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  autoComplete="username"
                  required
                />
                <input
                  className="input animate-fade-up stagger-4"
                  type="email"
                  aria-label={t("auth.email")}
                  placeholder={t("auth.email")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
                <input
                  className="input animate-fade-up stagger-5"
                  type="password"
                  aria-label={t("auth.password")}
                  placeholder={t("auth.password")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={6}
                />

                {mutation.isError && (
                  <p className="text-sm text-brand-coral">
                    {translateServerError((mutation.error as Error).message)}
                  </p>
                )}

                <motion.button
                  type="submit"
                  disabled={mutation.isPending}
                  whileTap={mutation.isPending ? undefined : { scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 450, damping: 28 }}
                  className="animate-fade-up stagger-6 h-12 w-full rounded-xl bg-brand-coral text-sm font-bold text-white shadow-pop-coral transition-[filter] hover:brightness-110 disabled:opacity-60"
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
    </AppShell>
  );
}
