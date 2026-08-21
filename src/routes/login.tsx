import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { login } from "@/functions/auth";
import { translateServerError } from "@/lib/i18n";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const mutation = useMutation({
    mutationFn: () => login({ data: { email, password } }),
    onSuccess: (user) => {
      queryClient.setQueryData(["currentUser"], user);
      navigate({ to: "/" });
    },
  });

  return (
    <AppShell hideNav>
      <div className="flex min-h-screen flex-col items-center justify-center px-6 py-10">
        <h1 className="animate-fade-up font-display text-4xl font-bold text-brand-coral">SONA</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("auth.welcome")}</p>

        <form
          className="animate-fade-up stagger-1 mt-8 w-full max-w-sm space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <h2 className="text-center font-display text-xl font-bold">{t("auth.loginTitle")}</h2>

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
            autoComplete="current-password"
            required
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
            className="w-full rounded-full bg-brand-coral py-3 text-sm font-bold text-white shadow-pop-coral disabled:opacity-60"
          >
            {mutation.isPending ? "…" : t("auth.loginCta")}
          </motion.button>
        </form>

        <p className="mt-6 text-sm text-muted-foreground">
          {t("auth.noAccount")}{" "}
          <Link to="/signup" className="font-semibold text-accent">
            {t("auth.createOne")}
          </Link>
        </p>

        <p className="mt-8 max-w-sm text-center text-[11px] text-muted-foreground">
          {t("auth.demoAccounts")}
        </p>
      </div>

      <style>{`.input { width: 100%; border-radius: 9999px; background: var(--color-input); padding: 12px 16px; font-size: 14px; outline: none; border: 1px solid var(--color-border); }
      .input:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-primary) 25%, transparent); }`}</style>
    </AppShell>
  );
}
