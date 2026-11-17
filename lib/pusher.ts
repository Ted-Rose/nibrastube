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

/**
 * Multi-profile fan-out for shared-table writes (a global videos-row
 * change lands on every whitelisting profile). Pusher accepts a
 * channel list on one trigger call, so a Pusher outage reports ONE
 * warning here instead of one per affected profile — and the ping
 * costs one HTTP call, not N. Chunked under the multi-event
 * channel cap; a failed chunk stops the loop since an outage won't
 * recover inside the same call.
 */
export async function triggerProfileEvents(
  profileIds: string[],
  event: string,
  data: Record<string, unknown>
): Promise<void> {
  for (let i = 0; i < profileIds.length; i += 50) {
    try {
      await pusherServer.trigger(
        profileIds.slice(i, i + 50).map((id) => `profile-${id}`),
        event,
        data
      );
    } catch (err) {
      captureProviderException(err, "provider_error");
      return;
    }
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
