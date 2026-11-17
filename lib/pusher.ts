import PusherServer from "pusher";
import PusherClient from "pusher-js";
import { captureProviderException } from "@/lib/report";

export const pusherServer = new PusherServer({
  appId: process.env.PUSHER_APP_ID!,
  key: process.env.PUSHER_KEY!,
  secret: process.env.PUSHER_SECRET!,
  cluster: process.env.PUSHER_CLUSTER!,
  useTLS: true,
});

/**
 * Fire-and-report profile ping: the mutation it announces is already
 * committed, so a Pusher outage must not fail the caller — it only
 * delays a client's router.refresh() until the next navigation.
 * Expected upstream outage → warning-level provider stream, never
 * the error fix queue (see lib/report.ts).
 */
export async function triggerProfileEvent(
  profileId: string,
  event: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    await pusherServer.trigger(`profile-${profileId}`, event, data);
  } catch (err) {
    captureProviderException(err, "provider_error");
  }
}

export const getPusherClient = () => {
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY || "34c7db220ff83d26d348";
  return new PusherClient(key, {
    // Client bundle can only see NEXT_PUBLIC_* vars — PUSHER_CLUSTER is
    // server-only and always resolves to undefined here.
    cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "eu",
  });
};
