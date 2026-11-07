import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useFormatNumber, useTimeAgo } from "@/hooks/use-locale-format";
import {
  ShieldCheck,
  Home,
  Trophy,
  Megaphone,
  Check,
  X,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  ChevronLeft,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  getAdminOverview,
  listAdminUsers,
  setUserRole,
  setUserBanned,
  listPromotions,
  reviewPromotion,
  createSponsorAd,
  listAdminCompetitions,
  createCompetition,
  updateCompetition,
  deleteCompetition,
} from "@/functions/admin";
import { useCurrentUser } from "@/hooks/use-current-user";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PostCoverBg } from "@/components/PostCoverBg";
import { translateServerError } from "@/lib/i18n";
import { formatCount } from "@/lib/mock-data";
import type { SessionUser } from "@/functions/auth";

export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ context }) => {
    const user = context.queryClient.getQueryData<SessionUser | null>(["currentUser"]);
    if (!user || user.role !== "admin") throw redirect({ to: "/" });
  },
  component: AdminPage,
});

function AdminPage() {
  const [tab, setTab] = useState<"overview" | "users" | "competitions" | "promotions">("overview");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur lg:px-8">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-brand-coral" />
          <h1 className="text-lg font-bold">ניהול · Studio26</h1>
        </div>
        <Link
          to="/"
          className="flex h-10 items-center gap-1.5 rounded-xl border border-[var(--hairline-strong)] px-3 text-sm font-semibold transition-colors hover:bg-card press-scale"
        >
          <Home className="h-3.5 w-3.5" /> חזרה לאפליקציה
        </Link>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 lg:px-8">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="h-auto max-w-full flex-wrap justify-start gap-1 rounded-xl bg-[var(--surface-sunken)] ring-1 ring-border">
            <TabsTrigger value="overview">סקירה כללית</TabsTrigger>
            <TabsTrigger value="users">משתמשים</TabsTrigger>
            <TabsTrigger value="competitions">תחרויות</TabsTrigger>
            <TabsTrigger value="promotions">קידומים ומודעות</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <OverviewTab onOpenPromotions={() => setTab("promotions")} />
          </TabsContent>
          <TabsContent value="users">
            <UsersTab />
          </TabsContent>
          <TabsContent value="competitions">
            <CompetitionsTab />
          </TabsContent>
          <TabsContent value="promotions">
            <PromotionsTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

/** One panel per group of numbers; cells split by hairlines, values set as readouts. */
function StatGroup({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: number | undefined }[];
}) {
  return (
    <section>
      <SectionLabel>{title}</SectionLabel>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[18px] border border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
        {items.map((it) => (
          <div key={it.label} className="bg-card px-4 py-4">
            <p className="font-numeric text-2xl font-bold">
              {it.value === undefined ? "—" : formatCount(it.value)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{it.label}</p>
          </div>
        ))}
        {/* Close the last row of each breakpoint so the hairline grid has no bare gap. */}
        {Array.from({ length: 4 }).map((_, i) => {
          const phone = (2 - (items.length % 2)) % 2;
          const tablet = (3 - (items.length % 3)) % 3;
          const desk = (5 - (items.length % 5)) % 5;
          return (
            <div
              key={`pad-${i}`}
              aria-hidden
              className={`bg-card ${i < phone ? "block" : "hidden"} ${i < tablet ? "sm:block" : "sm:hidden"} ${i < desk ? "lg:block" : "lg:hidden"}`}
            />
          );
        })}
      </div>
    </section>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <h2 className="section-label mb-3">{children}</h2>;
}

// Every trend is a single series on its own chart, so one hue (the meter marigold) serves all
// three and the title names the series. Checked: 3:1+ contrast against the card surface.
const TREND_COLOR = "oklch(0.82 0.15 88)";
const AXIS_TEXT = "oklch(0.74 0.016 275)";

function TrendChart({
  id,
  title,
  data,
}: {
  id: string;
  title: string;
  data: { day: string; n: number }[];
}) {
  const total = data.reduce((sum, d) => sum + d.n, 0);
  return (
    <div className="rounded-[18px] border border-border bg-card p-4 shadow-pop">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="font-numeric text-lg font-bold">{formatCount(total)}</p>
      </div>
      <div dir="ltr" className="mt-3 h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={TREND_COLOR} stopOpacity={0.28} />
                <stop offset="100%" stopColor={TREND_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="oklch(1 0 0 / 0.06)" vertical={false} />
            <XAxis
              dataKey="day"
              tickFormatter={(d: string) => d.slice(5)}
              tick={{ fontSize: 10, fill: AXIS_TEXT }}
              axisLine={false}
              tickLine={false}
              interval={6}
              padding={{ left: 12, right: 4 }}
              minTickGap={10}
            />
            <YAxis
              allowDecimals={false}
              width={30}
              tick={{ fontSize: 10, fill: AXIS_TEXT }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ stroke: "oklch(1 0 0 / 0.25)", strokeWidth: 1 }}
              contentStyle={{
                fontSize: 12,
                borderRadius: 12,
                border: "1px solid oklch(1 0 0 / 0.14)",
                background: "var(--popover)",
                color: "var(--foreground)",
              }}
              labelStyle={{ color: "var(--muted-foreground)" }}
              itemStyle={{ color: "var(--foreground)" }}
            />
            <Area
              type="monotone"
              dataKey="n"
              name={title}
              stroke={TREND_COLOR}
              fill={`url(#${id})`}
              strokeWidth={2}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function OverviewTab({ onOpenPromotions }: { onOpenPromotions: () => void }) {
  const { data } = useQuery({ queryKey: ["admin", "overview"], queryFn: () => getAdminOverview() });
  const t = data?.totals;
  const pending = t?.promotionsPending ?? 0;

  return (
    <div className="mt-6 space-y-8">
      {/* What needs a decision comes first, not buried in a grid of equals. */}
      {pending > 0 && (
        <button
          onClick={onOpenPromotions}
          className="flex w-full items-center gap-4 rounded-[18px] border border-brand-coral/40 bg-brand-coral/10 px-5 py-4 text-start transition-colors hover:bg-brand-coral/15"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-coral text-white">
            <Megaphone className="h-5 w-5" />
          </span>
          <span className="flex-1">
            <span className="block font-semibold">
              {formatCount(pending)} בקשות קידום ממתינות לאישור
            </span>
            <span className="block text-sm text-muted-foreground">לחץ כדי לעבור לטיפול</span>
          </span>
          <ChevronLeft className="h-5 w-5 text-brand-coral" />
        </button>
      )}

      <StatGroup
        title="קהילה"
        items={[
          { label: "משתמשים", value: t?.users },
          { label: "פוסטים", value: t?.posts },
          { label: "לייקים", value: t?.likes },
          { label: "תגובות", value: t?.comments },
          { label: "עוקבים", value: t?.follows },
        ]}
      />

      <section>
        <SectionLabel>מגמות — 30 הימים האחרונים</SectionLabel>
        <div className="grid gap-3 lg:grid-cols-3">
          <TrendChart
            id="admin-trend-users"
            title="משתמשים חדשים"
            data={data?.trends.newUsers ?? []}
          />
          <TrendChart
            id="admin-trend-posts"
            title="פוסטים חדשים"
            data={data?.trends.newPosts ?? []}
          />
          <TrendChart
            id="admin-trend-promos"
            title="בקשות קידום שהוגשו"
            data={data?.trends.promotionsSubmitted ?? []}
          />
        </div>
      </section>

      <StatGroup
        title="כלכלה"
        items={[
          { label: "מתנות שנשלחו", value: t?.giftsSent },
          { label: "מטבעות שהוענקו במתנות", value: t?.coinsGifted },
          { label: "מטבעות במחזור (כל המשתמשים)", value: t?.coinsInCirculation },
        ]}
      />

      <StatGroup
        title="תחרויות ופעילות"
        items={[
          { label: "תחרויות", value: t?.competitions },
          { label: "השתתפויות בתחרויות", value: t?.competitionEntries },
          { label: "הצבעות", value: t?.competitionVotes },
          { label: "הודעות פרטיות", value: t?.messages },
          { label: "שיחות", value: t?.conversations },
          { label: "לייבים פעילים כרגע", value: t?.liveActive },
          { label: "סה״כ שידורי לייב", value: t?.liveTotal },
          { label: "שירי קריוקי במאגר", value: t?.karaokeTracks },
          { label: "אודישנים", value: t?.auditions },
        ]}
      />

      <StatGroup
        title="קידומים ומודעות"
        items={[
          { label: "ממתינים לאישור", value: t?.promotionsPending },
          { label: "מאושרים", value: t?.promotionsApproved },
          { label: "נדחו", value: t?.promotionsRejected },
        ]}
      />
    </div>
  );
}

function UsersTab() {
  const { data: me } = useCurrentUser();
  const timeAgo = useTimeAgo();
  const formatNumber = useFormatNumber();
  const [query, setQuery] = useState("");
  const queryClient = useQueryClient();

  const { data: rows } = useQuery({
    queryKey: ["admin", "users", query],
    queryFn: () => listAdminUsers({ data: { query } }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] });

  const roleMutation = useMutation({
    mutationFn: (vars: { userId: string; role: "user" | "admin" }) => setUserRole({ data: vars }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  const banMutation = useMutation({
    mutationFn: (vars: { userId: string; banned: boolean }) => setUserBanned({ data: vars }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  return (
    <div className="mt-4 space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="חיפוש לפי שם, יוזרניים או אימייל..."
        aria-label="חיפוש משתמשים"
        className="input max-w-sm"
      />
      {/* Phones and tablets: one row per person, actions under the identity. */}
      <ul className="list-group lg:hidden">
        {rows?.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">לא נמצאו משתמשים.</li>
        )}
        {rows?.map((u) => (
          <li key={u.id} className="px-4 py-3.5">
            <div className="flex items-center gap-3">
              <img src={u.avatarUrl} className="h-10 w-10 shrink-0 rounded-full" alt="" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="truncate font-semibold">{u.name}</span>
                  <span
                    className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                      u.role === "admin"
                        ? "bg-brand-gold/15 text-brand-gold"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {u.role === "admin" ? "אדמין" : "משתמש"}
                  </span>
                </p>
                <p className="bidi-auto truncate text-xs text-muted-foreground">
                  @{u.handle} · {u.email || "—"}
                </p>
              </div>
              <div className="shrink-0 text-end">
                <p className="font-numeric text-sm font-bold">{formatNumber(u.coinsBalance)}</p>
                <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 rounded-full ${u.isBanned ? "bg-[var(--danger-text)]" : "bg-teal-text"}`}
                  />
                  {u.isBanned ? "חסום" : "פעיל"}
                </p>
              </div>
            </div>
            {u.id !== me?.id && (
              <div className="mt-3 flex gap-2 ps-[3.25rem]">
                <button
                  onClick={() => {
                    const next = u.role === "admin" ? "user" : "admin";
                    const ok = window.confirm(
                      next === "admin"
                        ? `לתת ל-${u.name} הרשאות אדמין מלאות?`
                        : `להסיר את הרשאות האדמין של ${u.name}?`,
                    );
                    if (ok) roleMutation.mutate({ userId: u.id, role: next });
                  }}
                  disabled={roleMutation.isPending}
                  className="h-9 rounded-lg border border-border px-3 text-xs font-semibold transition-colors hover:bg-muted/60 disabled:opacity-50"
                >
                  {u.role === "admin" ? "הסר הרשאת אדמין" : "הפוך לאדמין"}
                </button>
                <button
                  onClick={() => {
                    const ok = window.confirm(
                      u.isBanned ? `לבטל את החסימה של ${u.name}?` : `לחסום את ${u.name}?`,
                    );
                    if (ok) banMutation.mutate({ userId: u.id, banned: !u.isBanned });
                  }}
                  disabled={banMutation.isPending}
                  className={`h-9 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:opacity-50 ${
                    u.isBanned
                      ? "border-border"
                      : "border-destructive/40 text-danger hover:bg-destructive/10"
                  }`}
                >
                  {u.isBanned ? "בטל חסימה" : "חסום"}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-[18px] border border-border bg-card shadow-pop lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>משתמש</TableHead>
              <TableHead>אימייל</TableHead>
              <TableHead>מטבעות</TableHead>
              <TableHead>תפקיד</TableHead>
              <TableHead>סטטוס</TableHead>
              <TableHead>הצטרף</TableHead>
              <TableHead>פעולות</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows?.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                  לא נמצאו משתמשים.
                </TableCell>
              </TableRow>
            )}
            {rows?.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <img src={u.avatarUrl} className="h-8 w-8 shrink-0 rounded-full" alt="" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{u.name}</p>
                      <p className="bidi-auto truncate text-xs text-muted-foreground">
                        @{u.handle}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-xs">{u.email || "—"}</TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatNumber(u.coinsBalance)}
                </TableCell>
                <TableCell>
                  <span
                    className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${
                      u.role === "admin"
                        ? "bg-brand-gold/15 text-brand-gold"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {u.role === "admin" ? "אדמין" : "משתמש"}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                    <span
                      aria-hidden
                      className={`h-2 w-2 rounded-full ${u.isBanned ? "bg-[var(--danger-text)]" : "bg-teal-text"}`}
                    />
                    {u.isBanned ? "חסום" : "פעיל"}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {timeAgo(u.createdAt)}
                </TableCell>
                <TableCell>
                  {u.id === me?.id ? (
                    <span className="text-xs text-muted-foreground">זה החשבון שלך</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => {
                          const next = u.role === "admin" ? "user" : "admin";
                          // Admin rights are a one-click escalation: confirm first.
                          const ok = window.confirm(
                            next === "admin"
                              ? `לתת ל-${u.name} הרשאות אדמין מלאות?`
                              : `להסיר את הרשאות האדמין של ${u.name}?`,
                          );
                          if (ok) roleMutation.mutate({ userId: u.id, role: next });
                        }}
                        disabled={roleMutation.isPending}
                        className="h-8 whitespace-nowrap rounded-lg border border-border px-2.5 text-xs font-semibold transition-colors hover:bg-muted/60 press-scale disabled:opacity-50"
                      >
                        {u.role === "admin" ? "הסר הרשאת אדמין" : "הפוך לאדמין"}
                      </button>
                      <button
                        onClick={() => {
                          const ok = window.confirm(
                            u.isBanned ? `לבטל את החסימה של ${u.name}?` : `לחסום את ${u.name}?`,
                          );
                          if (ok) banMutation.mutate({ userId: u.id, banned: !u.isBanned });
                        }}
                        disabled={banMutation.isPending}
                        className={`h-8 whitespace-nowrap rounded-lg border px-2.5 text-xs font-semibold transition-colors press-scale disabled:opacity-50 ${
                          u.isBanned
                            ? "border-border"
                            : "border-destructive/40 text-danger hover:bg-destructive/10"
                        }`}
                      >
                        {u.isBanned ? "בטל חסימה" : "חסום"}
                      </button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

type PromotionStatus = "pending" | "approved" | "rejected";
type PromotionRow = Awaited<ReturnType<typeof listPromotions>>[number];

const STATUS_FILTERS: { key: PromotionStatus | undefined; label: string }[] = [
  { key: "pending", label: "ממתינות" },
  { key: "approved", label: "מאושרות" },
  { key: "rejected", label: "נדחו" },
  { key: undefined, label: "הכל" },
];

function StatusBadge({ status, endAt }: { status: string; endAt: string | Date | null }) {
  if (status === "pending") return <Badge variant="outline">ממתין לאישור</Badge>;
  if (status === "rejected") return <Badge variant="destructive">נדחה</Badge>;
  const active = endAt ? new Date(endAt).getTime() > Date.now() : false;
  return active ? (
    <Badge className="border-transparent bg-accent text-accent-foreground">פעיל</Badge>
  ) : (
    <Badge variant="secondary">הסתיים</Badge>
  );
}

function PromotionsTab() {
  const timeAgo = useTimeAgo();
  const formatNumber = useFormatNumber();
  const [status, setStatus] = useState<PromotionStatus | undefined>("pending");
  const [newOpen, setNewOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<PromotionRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const queryClient = useQueryClient();

  const { data: promos } = useQuery({
    queryKey: ["admin", "promotions", status],
    queryFn: () => listPromotions({ data: { status } }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin", "promotions"] });

  const reviewMutation = useMutation({
    mutationFn: (vars: { id: string; decision: "approved" | "rejected"; reason?: string }) =>
      reviewPromotion({ data: vars }),
    onSuccess: () => {
      invalidate();
      toast.success("הבקשה עודכנה");
      setRejectTarget(null);
      setRejectReason("");
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.label}
              onClick={() => setStatus(s.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold press-scale ${
                status === s.key
                  ? "bg-primary text-primary-foreground"
                  : "border border-border hover:border-primary/50"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setNewOpen(true)}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-brand-coral px-4 text-sm font-bold text-white transition-[filter] hover:brightness-110 press-scale"
        >
          <Plus className="h-3.5 w-3.5" /> מודעת ספונסר חדשה
        </button>
      </div>

      {promos?.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          אין בקשות קידום בקטגוריה הזו.
        </p>
      )}

      <div className="space-y-2">
        {promos?.map((p) => (
          <div key={p.id} className="rounded-2xl border border-border bg-card p-4 shadow-pop">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={p.kind === "boost" ? "secondary" : "default"}>
                    {p.kind === "boost" ? "קידום פוסט" : "מודעת ספונסר"}
                  </Badge>
                  <StatusBadge status={p.status} endAt={p.endAt} />
                </div>
                <p className="mt-1.5 truncate font-semibold">{p.title || "(ללא כותרת)"}</p>
                <p className="text-xs text-muted-foreground">
                  {p.kind === "boost"
                    ? `מאת @${p.requesterHandle ?? "משתמש שנמחק"}`
                    : p.advertiserName || "—"}
                </p>
              </div>
              <div className="shrink-0 text-end text-xs text-muted-foreground">
                <p>
                  {formatNumber(p.budgetCoins)} מטבעות · {p.durationDays} ימים
                </p>
                <p>{timeAgo(p.createdAt)}</p>
              </div>
            </div>

            {p.description && <p className="mt-2 text-sm">{p.description}</p>}
            {p.targetUrl && (
              <a
                href={p.targetUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block truncate text-xs text-brand-coral underline"
              >
                {p.targetUrl}
              </a>
            )}
            {p.status === "rejected" && p.rejectionReason && (
              <p className="mt-2 rounded-lg bg-destructive/10 p-2 text-xs text-danger">
                {p.rejectionReason}
              </p>
            )}

            {p.status === "pending" && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => reviewMutation.mutate({ id: p.id, decision: "approved" })}
                  disabled={reviewMutation.isPending}
                  className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-bold text-accent-foreground press-scale disabled:opacity-60"
                >
                  <Check className="h-3.5 w-3.5" /> אשר
                </button>
                <button
                  onClick={() => setRejectTarget(p)}
                  disabled={reviewMutation.isPending}
                  className="flex items-center gap-1.5 rounded-full border border-destructive/40 px-3 py-1.5 text-xs font-bold text-danger press-scale disabled:opacity-60"
                >
                  <X className="h-3.5 w-3.5" /> דחה
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={!!rejectTarget} onOpenChange={(v) => !v && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>סיבת דחייה</DialogTitle>
          </DialogHeader>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="הסבר קצר — יוצג למי ששלח את הבקשה"
            rows={3}
            className="w-full rounded-xl border border-border bg-input p-3 text-sm outline-none focus:border-primary"
          />
          <DialogFooter>
            <button
              onClick={() =>
                rejectTarget &&
                reviewMutation.mutate({
                  id: rejectTarget.id,
                  decision: "rejected",
                  reason: rejectReason,
                })
              }
              disabled={reviewMutation.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-destructive py-2.5 text-sm font-bold text-destructive-foreground press-scale disabled:opacity-60"
            >
              {reviewMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              דחה בקשה
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewSponsorAdDialog open={newOpen} onOpenChange={setNewOpen} onCreated={invalidate} />
    </div>
  );
}

function NewSponsorAdDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [advertiserName, setAdvertiserName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [budgetCoins, setBudgetCoins] = useState("0");
  const [durationDays, setDurationDays] = useState("7");

  const reset = () => {
    setTitle("");
    setAdvertiserName("");
    setDescription("");
    setImageUrl("");
    setTargetUrl("");
    setBudgetCoins("0");
    setDurationDays("7");
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createSponsorAd({
        data: {
          title,
          advertiserName,
          description,
          imageUrl,
          targetUrl,
          budgetCoins: Number(budgetCoins) || 0,
          durationDays: Number(durationDays) || 1,
        },
      }),
    onSuccess: () => {
      toast.success("המודעה נוצרה והיא פעילה");
      onCreated();
      onOpenChange(false);
      reset();
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>מודעת ספונסר חדשה</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="כותרת המודעה"
            className="admin-dialog-input"
          />
          <input
            value={advertiserName}
            onChange={(e) => setAdvertiserName(e.target.value)}
            placeholder="שם המפרסם / העסק"
            className="admin-dialog-input"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="תיאור"
            rows={2}
            className="admin-dialog-input"
          />
          <input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="קישור לתמונה"
            className="admin-dialog-input"
          />
          <input
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="קישור יעד (אתר / דף נחיתה)"
            className="admin-dialog-input"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              min={0}
              value={budgetCoins}
              onChange={(e) => setBudgetCoins(e.target.value)}
              placeholder="תקציב (מטבעות)"
              className="admin-dialog-input"
            />
            <input
              type="number"
              min={1}
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
              placeholder="משך (ימים)"
              className="admin-dialog-input"
            />
          </div>
        </div>
        <DialogFooter>
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !title.trim()}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-coral text-sm font-bold text-white shadow-pop-coral press-scale disabled:opacity-60"
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            צור והפעל מודעה
          </button>
        </DialogFooter>
        <style>{`.admin-dialog-input { width: 100%; border-radius: 12px; background: var(--color-input); padding: 10px 12px; font-size: 14px; outline: none; border: 1px solid var(--color-border); }`}</style>
      </DialogContent>
    </Dialog>
  );
}

// ── Competitions ──────────────────────────────────────────────────────────────────────────────

type AdminCompetition = Awaited<ReturnType<typeof listAdminCompetitions>>[number];
type CompetitionStage = "quarter" | "semi" | "final";
type CompetitionStatus = "upcoming" | "active" | "finished";

const STAGE_LABELS: Record<CompetitionStage, string> = {
  quarter: "רבע גמר",
  semi: "חצי גמר",
  final: "גמר",
};
const COMPETITION_STATUS_LABELS: Record<CompetitionStatus, string> = {
  upcoming: "בקרוב",
  active: "פעילה",
  finished: "הסתיימה",
};
// Cover glow hues for the generated competition art — spread around the wheel, brand-leaning.
const COVER_HUES = [320, 280, 250, 210, 175, 140, 45, 20];

function CompetitionsTab() {
  const queryClient = useQueryClient();
  const formatNumber = useFormatNumber();
  const [editing, setEditing] = useState<AdminCompetition | "new" | null>(null);
  const [deleting, setDeleting] = useState<AdminCompetition | null>(null);

  const { data: rows } = useQuery({
    queryKey: ["admin", "competitions"],
    queryFn: () => listAdminCompetitions(),
  });

  // The public list/detail pages and the overview counts all read competitions too.
  const invalidate = () => {
    for (const key of [["admin"], ["competitions"], ["competition"]]) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const statusMutation = useMutation({
    mutationFn: (vars: { row: AdminCompetition; status: CompetitionStatus }) =>
      updateCompetition({
        data: {
          id: vars.row.id,
          title: vars.row.title,
          prize: vars.row.prize,
          stage: vars.row.stage as CompetitionStage,
          hue: vars.row.hue,
          status: vars.status,
        },
      }),
    onSuccess: (_, vars) => {
      invalidate();
      toast.success(`הסטטוס עודכן ל"${COMPETITION_STATUS_LABELS[vars.status]}"`);
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCompetition({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("התחרות נמחקה");
      setDeleting(null);
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          רק תחרות <span className="font-semibold text-foreground">פעילה</span> פתוחה להגשות
          ולהצבעות.
        </p>
        <button
          onClick={() => setEditing("new")}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-brand-coral px-4 text-sm font-bold text-white transition-[filter] hover:brightness-110 press-scale"
        >
          <Plus className="h-3.5 w-3.5" /> תחרות חדשה
        </button>
      </div>

      {rows?.length === 0 && (
        <div className="rounded-[18px] border border-dashed border-border p-10 text-center">
          <Trophy className="mx-auto h-8 w-8 text-brand-coral" />
          <p className="mt-2 text-sm text-muted-foreground">עדיין אין תחרויות.</p>
          <button
            onClick={() => setEditing("new")}
            className="mt-4 h-11 rounded-xl bg-brand-coral px-5 text-sm font-bold text-white press-scale"
          >
            צור את התחרות הראשונה
          </button>
        </div>
      )}

      <div className={rows?.length ? "list-group" : "hidden"}>
        {rows?.map((c) => (
          <div
            key={c.id}
            className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:gap-6"
          >
            <div className="min-w-0 flex-1">
              <p className="bidi-auto truncate font-semibold">{c.title}</p>
              <p className="mt-1 flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
                <span>{STAGE_LABELS[c.stage as CompetitionStage] ?? c.stage}</span>
                <bdi className="font-numeric text-sm font-bold text-brand-gold">{c.prize}</bdi>
                <span>
                  {formatNumber(c.entries)} הגשות · {formatNumber(c.votes)} הצבעות
                </span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div
                role="group"
                aria-label="סטטוס"
                className="flex gap-0.5 rounded-lg bg-[var(--surface-sunken)] p-0.5 ring-1 ring-border"
              >
                {(Object.keys(COMPETITION_STATUS_LABELS) as CompetitionStatus[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => c.status !== s && statusMutation.mutate({ row: c, status: s })}
                    disabled={statusMutation.isPending}
                    aria-pressed={c.status === s}
                    className={`h-8 rounded-md px-2.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
                      c.status === s
                        ? s === "active"
                          ? "bg-brand-gold text-accent-foreground"
                          : "bg-muted text-foreground ring-1 ring-[var(--hairline-strong)]"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {COMPETITION_STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
              <span className="ms-auto flex gap-1">
                <button
                  onClick={() => setEditing(c)}
                  aria-label="עריכה"
                  className="grid h-9 w-9 place-items-center rounded-lg border border-border transition-colors hover:bg-muted/60 press-scale"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setDeleting(c)}
                  aria-label="מחיקה"
                  className="grid h-9 w-9 place-items-center rounded-lg border border-border transition-colors hover:bg-destructive/10 hover:text-danger press-scale"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <CompetitionDialog
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={invalidate}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>למחוק את &quot;{deleting?.title}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && deleting.entries > 0
                ? `יימחקו גם ${deleting.entries} ההגשות ו-${deleting.votes} ההצבעות שלה. הפוסטים עצמם נשארים אצל המשתמשים. `
                : "אין בה הגשות. "}
              לא ניתן לבטל את הפעולה.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleting) deleteMutation.mutate(deleting.id);
              }}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              מחק תחרות
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CompetitionDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: AdminCompetition | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [prize, setPrize] = useState(initial?.prize ?? "");
  const [stage, setStage] = useState<CompetitionStage>(
    (initial?.stage as CompetitionStage) ?? "quarter",
  );
  const [status, setStatus] = useState<CompetitionStatus>(
    (initial?.status as CompetitionStatus) ?? "upcoming",
  );
  const [hue, setHue] = useState(initial?.hue ?? COVER_HUES[0]);
  // New competitions get their real cover seed on the server; preview with a stable stand-in.
  const previewSeed = initial?.coverSeed ?? "new-competition-preview";

  const saveMutation = useMutation({
    mutationFn: () => {
      const data = { title, prize, stage, status, hue };
      return initial
        ? updateCompetition({ data: { ...data, id: initial.id } })
        : createCompetition({ data });
    },
    onSuccess: () => {
      toast.success(initial ? "התחרות עודכנה" : "התחרות נוצרה");
      onSaved();
      onClose();
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  const canSave = !!title.trim() && !!prize.trim() && !saveMutation.isPending;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "עריכת תחרות" : "תחרות חדשה"}</DialogTitle>
        </DialogHeader>

        {/* Live preview — the same card the competitions page renders. */}
        <div className="relative h-40 overflow-hidden rounded-2xl">
          <PostCoverBg hue={hue} seed={previewSeed} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-3">
            <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
              {STAGE_LABELS[stage]}
            </span>
            <p className="bidi-auto mt-1.5 truncate font-display text-xl font-bold text-white">
              {title.trim() || "שם התחרות"}
            </p>
            <p className="flex items-center gap-1 text-xs text-white/80">
              <Trophy className="h-3.5 w-3.5 text-accent" />
              <bdi>{prize.trim() || "פרס"}</bdi>
            </p>
          </div>
        </div>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) saveMutation.mutate();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              שם התחרות
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              placeholder="למשל: קול ישראל 2026"
              className="w-full rounded-xl border border-border bg-input px-3 py-2.5 text-sm outline-none focus:border-primary"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">פרס</span>
            <input
              value={prize}
              onChange={(e) => setPrize(e.target.value)}
              maxLength={40}
              placeholder="למשל: ₪10,000 או 5,000 מטבעות"
              className="w-full rounded-xl border border-border bg-input px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
          </label>

          <fieldset>
            <legend className="mb-1 text-xs font-semibold text-muted-foreground">שלב</legend>
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.keys(STAGE_LABELS) as CompetitionStage[]).map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => setStage(s)}
                  aria-pressed={stage === s}
                  className={`rounded-xl py-2 text-sm font-semibold press-scale ${
                    stage === s ? "bg-primary text-primary-foreground" : "border border-border"
                  }`}
                >
                  {STAGE_LABELS[s]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1 text-xs font-semibold text-muted-foreground">סטטוס</legend>
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.keys(COMPETITION_STATUS_LABELS) as CompetitionStatus[]).map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => setStatus(s)}
                  aria-pressed={status === s}
                  className={`rounded-xl py-2 text-sm font-semibold press-scale ${
                    status === s ? "bg-primary text-primary-foreground" : "border border-border"
                  }`}
                >
                  {COMPETITION_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              בקרוב — מוצגת בלי אפשרות להגיש · פעילה — פתוחה להגשות ולהצבעות · הסתיימה — נסגרת
            </p>
          </fieldset>

          <fieldset>
            <legend className="mb-1 text-xs font-semibold text-muted-foreground">צבע עטיפה</legend>
            <div className="flex flex-wrap gap-2">
              {COVER_HUES.map((h) => (
                <button
                  type="button"
                  key={h}
                  onClick={() => setHue(h)}
                  aria-label={`גוון ${h}`}
                  aria-pressed={hue === h}
                  className={`h-8 w-8 rounded-full press-scale ${
                    hue === h ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : ""
                  }`}
                  style={{ backgroundColor: `hsl(${h} 80% 55%)` }}
                />
              ))}
            </div>
          </fieldset>

          <DialogFooter>
            <button
              type="submit"
              disabled={!canSave}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-coral text-sm font-bold text-white shadow-pop-coral press-scale disabled:opacity-60"
            >
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {initial ? "שמור שינויים" : "צור תחרות"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
