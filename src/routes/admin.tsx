import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  ShieldCheck,
  Home,
  Users,
  Music2,
  Heart,
  MessageSquare,
  UserPlus,
  Gift,
  Coins,
  Trophy,
  Radio,
  GraduationCap,
  Megaphone,
  Check,
  X,
  Loader2,
  Plus,
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
} from "@/functions/admin";
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
  const [tab, setTab] = useState<"overview" | "users" | "promotions">("overview");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-brand-coral" />
          <h1 className="font-display text-lg font-bold">ניהול · SONA</h1>
        </div>
        <Link
          to="/"
          className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold press-scale hover:border-primary/50"
        >
          <Home className="h-3.5 w-3.5" /> חזרה לאפליקציה
        </Link>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="overview">סקירה כללית</TabsTrigger>
            <TabsTrigger value="users">משתמשים</TabsTrigger>
            <TabsTrigger value="promotions">קידומים ומודעות</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <OverviewTab />
          </TabsContent>
          <TabsContent value="users">
            <UsersTab />
          </TabsContent>
          <TabsContent value="promotions">
            <PromotionsTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: typeof Users;
  label: string;
  value: number | undefined;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-3 shadow-pop ${
        highlight && value ? "border-brand-coral bg-brand-coral/5" : "border-border bg-card"
      }`}
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      <p className="mt-1.5 font-display text-xl font-bold tabular-nums">
        {value === undefined ? "—" : formatCount(value)}
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </h2>
  );
}

function TrendChart({
  id,
  title,
  data,
  color,
}: {
  id: string;
  title: string;
  data: { day: string; n: number }[];
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-pop">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-2 h-44">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.4} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="currentColor"
              className="text-border/50"
              vertical={false}
            />
            <XAxis
              dataKey="day"
              tickFormatter={(d: string) => d.slice(5)}
              tick={{ fontSize: 10 }}
              interval={4}
              minTickGap={10}
            />
            <YAxis allowDecimals={false} width={30} tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{
                fontSize: 12,
                borderRadius: 12,
                border: "1px solid var(--color-border)",
                background: "var(--color-background)",
              }}
            />
            <Area type="monotone" dataKey="n" stroke={color} fill={`url(#${id})`} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function OverviewTab() {
  const { data } = useQuery({ queryKey: ["admin", "overview"], queryFn: () => getAdminOverview() });
  const t = data?.totals;

  return (
    <div className="mt-4 space-y-6">
      <section>
        <SectionLabel>קהילה</SectionLabel>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard icon={Users} label="משתמשים" value={t?.users} />
          <StatCard icon={Music2} label="פוסטים" value={t?.posts} />
          <StatCard icon={Heart} label="לייקים" value={t?.likes} />
          <StatCard icon={MessageSquare} label="תגובות" value={t?.comments} />
          <StatCard icon={UserPlus} label="עוקבים" value={t?.follows} />
        </div>
      </section>

      <section>
        <SectionLabel>כלכלה</SectionLabel>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard icon={Gift} label="מתנות שנשלחו" value={t?.giftsSent} />
          <StatCard icon={Coins} label="מטבעות שהוענקו במתנות" value={t?.coinsGifted} />
          <StatCard
            icon={Coins}
            label="מטבעות במחזור (כל המשתמשים)"
            value={t?.coinsInCirculation}
          />
        </div>
      </section>

      <section>
        <SectionLabel>תחרויות ופעילות</SectionLabel>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard icon={Trophy} label="תחרויות" value={t?.competitions} />
          <StatCard icon={Trophy} label="השתתפויות בתחרויות" value={t?.competitionEntries} />
          <StatCard icon={Trophy} label="הצבעות" value={t?.competitionVotes} />
          <StatCard icon={MessageSquare} label="הודעות פרטיות" value={t?.messages} />
          <StatCard icon={MessageSquare} label="שיחות" value={t?.conversations} />
          <StatCard icon={Radio} label="לייבים פעילים כרגע" value={t?.liveActive} />
          <StatCard icon={Radio} label="סה״כ שידורי לייב" value={t?.liveTotal} />
          <StatCard icon={Music2} label="שירי קריוקי במאגר" value={t?.karaokeTracks} />
          <StatCard icon={GraduationCap} label="אודישנים" value={t?.auditions} />
        </div>
      </section>

      <section>
        <SectionLabel>קידומים ומודעות</SectionLabel>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard
            icon={Megaphone}
            label="ממתינים לאישור"
            value={t?.promotionsPending}
            highlight
          />
          <StatCard icon={Megaphone} label="מאושרים" value={t?.promotionsApproved} />
          <StatCard icon={Megaphone} label="נדחו" value={t?.promotionsRejected} />
        </div>
      </section>

      <section>
        <SectionLabel>מגמות — 30 הימים האחרונים</SectionLabel>
        <div className="grid gap-3 lg:grid-cols-3">
          <TrendChart
            id="admin-trend-users"
            title="משתמשים חדשים"
            data={data?.trends.newUsers ?? []}
            color="#f97362"
          />
          <TrendChart
            id="admin-trend-posts"
            title="פוסטים חדשים"
            data={data?.trends.newPosts ?? []}
            color="#6c8cff"
          />
          <TrendChart
            id="admin-trend-promos"
            title="בקשות קידום שהוגשו"
            data={data?.trends.promotionsSubmitted ?? []}
            color="#f5b942"
          />
        </div>
      </section>
    </div>
  );
}

function UsersTab() {
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
        className="w-full max-w-sm rounded-full border border-border bg-input px-4 py-2 text-sm outline-none focus:border-primary"
      />
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-pop">
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
                      <p className="truncate text-xs text-muted-foreground">@{u.handle}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-xs">{u.email || "—"}</TableCell>
                <TableCell className="font-mono tabular-nums">
                  {u.coinsBalance.toLocaleString()}
                </TableCell>
                <TableCell>
                  <Badge variant={u.role === "admin" ? "default" : "outline"}>
                    {u.role === "admin" ? "אדמין" : "משתמש"}
                  </Badge>
                </TableCell>
                <TableCell>
                  {u.isBanned ? (
                    <Badge variant="destructive">חסום</Badge>
                  ) : (
                    <Badge variant="secondary">פעיל</Badge>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(u.createdAt), { addSuffix: true })}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() =>
                        roleMutation.mutate({
                          userId: u.id,
                          role: u.role === "admin" ? "user" : "admin",
                        })
                      }
                      disabled={roleMutation.isPending}
                      className="whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-xs font-semibold press-scale hover:border-primary/50 disabled:opacity-50"
                    >
                      {u.role === "admin" ? "הסר הרשאת אדמין" : "הפוך לאדמין"}
                    </button>
                    <button
                      onClick={() => banMutation.mutate({ userId: u.id, banned: !u.isBanned })}
                      disabled={banMutation.isPending}
                      className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold press-scale disabled:opacity-50 ${
                        u.isBanned
                          ? "border-border"
                          : "border-destructive/40 text-destructive hover:bg-destructive/10"
                      }`}
                    >
                      {u.isBanned ? "בטל חסימה" : "חסום"}
                    </button>
                  </div>
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
          className="flex items-center gap-1.5 rounded-full bg-brand-coral px-3 py-1.5 text-xs font-bold text-white shadow-pop-coral press-scale"
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
                  {p.budgetCoins.toLocaleString()} מטבעות · {p.durationDays} ימים
                </p>
                <p>{formatDistanceToNow(new Date(p.createdAt), { addSuffix: true })}</p>
              </div>
            </div>

            {p.description && <p className="mt-2 text-sm">{p.description}</p>}
            {p.targetUrl && (
              <a
                href={p.targetUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block truncate text-xs text-primary underline"
              >
                {p.targetUrl}
              </a>
            )}
            {p.status === "rejected" && p.rejectionReason && (
              <p className="mt-2 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
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
                  className="flex items-center gap-1.5 rounded-full border border-destructive/40 px-3 py-1.5 text-xs font-bold text-destructive press-scale disabled:opacity-60"
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
            className="flex w-full items-center justify-center gap-2 rounded-full bg-brand-coral py-2.5 text-sm font-bold text-white shadow-pop-coral press-scale disabled:opacity-60"
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
