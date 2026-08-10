import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/AppShell";
import { signup } from "@/functions/auth";
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

  const mutation = useMutation({
    mutationFn: () => signup({ data: { handle, name, email, password } }),
    onSuccess: (user) => {
      queryClient.setQueryData(["currentUser"], user);
      navigate({ to: "/" });
    },
  });

  return (
    <AppShell hideNav>
      <div className="flex min-h-screen flex-col items-center justify-center px-6 py-10">
        <h1 className="font-display text-4xl font-bold gradient-neon-text">SONA</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("auth.welcome")}</p>

        <form
          className="mt-8 w-full max-w-sm space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <h2 className="text-center font-display text-xl font-bold">{t("auth.signupTitle")}</h2>

          <input
            className="input"
            placeholder={t("auth.name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
          />
          <input
            className="input"
            placeholder={t("auth.handle")}
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            autoComplete="username"
            required
          />
          <input
            className="input"
            type="email"
            placeholder={t("auth.email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <input
            className="input"
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

          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full rounded-full gradient-neon py-3 text-sm font-bold text-white glow-pink disabled:opacity-60"
          >
            {mutation.isPending ? "…" : t("auth.signupCta")}
          </button>
        </form>

        <p className="mt-6 text-sm text-muted-foreground">
          {t("auth.haveAccount")}{" "}
          <Link to="/login" className="font-semibold text-accent">
            {t("auth.logIn")}
          </Link>
        </p>
      </div>

      <style>{`.input { width: 100%; border-radius: 9999px; background: var(--color-input); padding: 12px 16px; font-size: 14px; outline: none; border: 1px solid var(--color-border); }
      .input:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-primary) 25%, transparent); }`}</style>
    </AppShell>
  );
}
