import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  redirect,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useTranslation, I18nextProvider } from "react-i18next";
import type { i18n as I18nInstance } from "i18next";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { getCurrentUser } from "../functions/auth";
import { detectServerLanguage } from "../functions/locale";
import i18n, { isRTL, reconcileClientLanguage } from "../lib/i18n";
import { Toaster } from "../components/ui/sonner";

const PUBLIC_PATHS = new Set(["/login", "/signup"]);

function NotFoundComponent() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl font-bold gradient-neon-text">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{t("error.notFoundTitle")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("error.notFoundBody")}</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-full gradient-neon px-6 py-2.5 text-sm font-semibold text-white glow-pink"
          >
            {t("error.backToFeed")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const { t } = useTranslation();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("error.genericTitle")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("error.genericBody")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-full gradient-neon px-5 py-2 text-sm font-semibold text-white glow-pink"
          >
            {t("error.tryAgain")}
          </button>
          <a href="/" className="rounded-full border border-border px-5 py-2 text-sm font-medium">
            {t("error.goHome")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async ({ location, context }) => {
    // Only on the server, and only for the initial SSR pass of a fresh request (never on
    // client-side navigations, which would otherwise fight a manual in-app language switch).
    // We only resolve which language to use here; the actual per-request i18next instance is
    // built during render (see RootShell) rather than by mutating the shared `i18n` singleton
    // — that singleton is process-wide, so under concurrent requests (e.g. two visitors with
    // different languages) mutating it directly races and can bake the wrong language's text
    // into a response's SSR output, which then fails to hydrate on the client.
    const lang = typeof document === "undefined" ? await detectServerLanguage() : undefined;

    const user = await getCurrentUser();
    context.queryClient.setQueryData(["currentUser"], user);

    const isPublic = PUBLIC_PATHS.has(location.pathname);
    if (!user && !isPublic) throw redirect({ to: "/login" });
    if (user && isPublic) throw redirect({ to: "/" });

    return { user, lang };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#0a0014" },
      { title: "SONA — Music Social Network" },
      {
        name: "description",
        content:
          "Sing, produce, compete and get discovered. A global music social network for artists, DJs, producers and fans.",
      },
      { property: "og:title", content: "SONA — Music Social Network" },
      { property: "og:description", content: "Sing, produce, compete and get discovered." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  const { lang } = Route.useRouteContext();
  // On the server, build a throwaway clone scoped to this render call so concurrent requests
  // for different languages can never see each other's state (see beforeLoad above). On the
  // client there's only ever one request at a time, so we keep using the real shared instance
  // — that's what setLanguage()'s changeLanguage() calls need to keep working reactively.
  const requestI18n: I18nInstance =
    typeof document === "undefined" && lang ? i18n.cloneInstance({ lng: lang }) : i18n;
  const resolvedLang = requestI18n.language;
  return (
    <html lang={resolvedLang} dir={isRTL(resolvedLang) ? "rtl" : "ltr"} className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        <I18nextProvider i18n={requestI18n}>{children}</I18nextProvider>
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    reconcileClientLanguage();
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster richColors position="top-center" />
    </QueryClientProvider>
  );
}
