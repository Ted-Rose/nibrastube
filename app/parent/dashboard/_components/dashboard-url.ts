// Param validation — bad values render nothing, never a 404.
export const VIDEO_ID_PARAM_RE = /^[A-Za-z0-9_-]{11}$/;
export const CHANNEL_ID_PARAM_RE = /^UC[\w-]{10,40}$/;

// Single dashboard URL builder so every link (type tabs, profile
// picker, back link, card hrefs, overlay close) drops/keeps params
// deliberately: `channel` only survives inside the channels tab —
// switching to type=videos, changing q, or switching profile
// naturally drops it since callers don't re-pass it. `video`
// composes with everything (search results AND the drill-in).
export function dashboardUrl(
  base: {
    profileId: string;
    q: string;
    type: "videos" | "channels";
  },
  {
    profileId: profileParam,
    type: typeParam,
    channel: channelParam,
    video: videoParam,
  }: {
    profileId?: string;
    type?: "videos" | "channels";
    channel?: string | null;
    video?: string | null;
  } = {}
): string {
  const t = typeParam ?? base.type;
  const sp = new URLSearchParams();
  sp.set("profileId", profileParam ?? base.profileId);
  if (base.q) sp.set("q", base.q);
  sp.set("type", t);
  if (t === "channels" && channelParam) {
    sp.set("channel", channelParam);
  }
  if (videoParam) sp.set("video", videoParam);
  return `/parent/dashboard?${sp.toString()}`;
}
