import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { ProfileView } from "@/components/ProfileView";
import { useCurrentUser } from "@/hooks/use-current-user";

export const Route = createFileRoute("/profile")({
  component: OwnProfilePage,
});

function OwnProfilePage() {
  const { data: me } = useCurrentUser();

  if (!me) {
    return (
      <AppShell>
        <TopBar />
      </AppShell>
    );
  }

  return <ProfileView handle={me.handle} />;
}
