// Server-only LiveKit helpers shared between functions/live.ts (rooms, guests, PK battles) and
// functions/wallet.ts (sendGift needs to push a live score update when a gift lands during an
// active PK battle — see pushLiveData below). Never import this from a route/component; it reads
// server env vars directly and isn't meant to reach the client bundle.
import { AccessToken, RoomServiceClient, DataPacket_Kind } from "livekit-server-sdk";

export { DataPacket_Kind };

export function isLiveKitConfigured(): boolean {
  return !!(
    process.env.LIVEKIT_URL &&
    process.env.LIVEKIT_API_KEY &&
    process.env.LIVEKIT_API_SECRET
  );
}

export function getLiveKitRoomService() {
  return new RoomServiceClient(
    process.env.LIVEKIT_URL!,
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  );
}

export async function createLiveKitToken(
  identity: string,
  name: string,
  roomName: string,
  canPublish: boolean,
) {
  const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
    identity,
    name,
  });
  at.addGrant({ roomJoin: true, room: roomName, canPublish, canSubscribe: true });
  return at.toJwt();
}

// Best-effort real-time push over LiveKit's own data channel (see useDataChannel on the client) —
// used for things a DB notification/poll alone is too slow for: an invite or a live PK score tick
// landing on someone who's mid-broadcast right now. Never throws: whoever's listening gets it live
// if they're connected, and every one of these events also has a durable fallback (a DB
// notification, or the next poll of the battle/room state) so a dropped data message is never the
// only way to find out.
export async function pushLiveData(
  roomLivekitName: string,
  payload: Record<string, unknown>,
  destinationIdentities?: string[],
) {
  if (!isLiveKitConfigured()) return;
  await getLiveKitRoomService()
    .sendData(
      roomLivekitName,
      new TextEncoder().encode(JSON.stringify(payload)),
      DataPacket_Kind.RELIABLE,
      destinationIdentities ? { destinationIdentities } : {},
    )
    .catch(() => {});
}
