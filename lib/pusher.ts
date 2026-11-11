import PusherServer from "pusher";
import PusherClient from "pusher-js";

export const pusherServer = new PusherServer({
  appId: process.env.PUSHER_APP_ID!,
  key: process.env.PUSHER_KEY!,
  secret: process.env.PUSHER_SECRET!,
  cluster: process.env.PUSHER_CLUSTER!,
  useTLS: true,
});

export const getPusherClient = () => {
  return new PusherClient(process.env.NEXT_PUBLIC_PUSHER_KEY || "34c7db220ff83d26d348", {
    // Client bundle can only see NEXT_PUBLIC_* vars — PUSHER_CLUSTER is
    // server-only and always resolves to undefined here.
    cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "eu",
  });
};
