import { createFileRoute } from "@tanstack/react-router";
import { ProfileView } from "@/components/ProfileView";

export const Route = createFileRoute("/profile_/$handle")({
  component: OtherProfilePage,
});

function OtherProfilePage() {
  const { handle } = Route.useParams();
  return <ProfileView handle={handle} />;
}
