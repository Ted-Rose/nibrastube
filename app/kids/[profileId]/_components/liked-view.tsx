import Link from "next/link";
import { House } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/empty-state";
import { KidsVideoGrid } from "@/components/kids-video-grid";
import { LinkPendingSpinner } from "@/components/link-pending-spinner";
import { SaveToPlaylistProvider } from "@/components/save-to-playlist-dialog";
import { getSession, parentSession } from "@/lib/auth";
import {
  getLikedVideos,
  getPlaylists,
  kidsFeedQuery,
  kidsPortalUrl,
  type KidsFeedParams,
} from "@/lib/kids-feed";
import { FeedHeader } from "@/components/feed-header";
import { feedTitle, KIDS_VIEWS } from "./view-config";

// Liked tab — videos the kid tapped 👍 on, newest reaction first.
export async function LikedView({
  profileId,
  feed,
}: {
  profileId: string;
  feed: KidsFeedParams;
}) {
  const { q: query } = feed;

  const rows = await getLikedVideos(profileId, { q: query });
  // Playlists snapshot — feeds the shared "Save to playlist" dialog
  // behind every video card's ⋮ menu.
  const playlistRows = await getPlaylists(profileId);
  const ViewIcon = KIDS_VIEWS.liked.icon;

  // "Home" goes role-dependent: a parent session heads back to the
  // dashboard, everyone else (kid session or a kid-locked device with
  // only the activeProfileId cookie) lands on this profile's feed —
  // the picker isn't reachable from a locked device anyway.
  const parent = parentSession(await getSession());
  const homeHref = parent ? "/parent/dashboard" : `/kids/${profileId}`;

  return (
    <>
      <FeedHeader
        title={feedTitle(feed)}
        actions={
          <Link
            href={homeHref}
            // /parent/dashboard is auth-conditional — proxy.ts may 307
            // it to the PIN gate, and a prefetched redirect pollutes
            // the router cache. The kids feed href resolves directly.
            prefetch={parent ? false : undefined}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-lg font-black text-white shadow-md transition-transform hover:scale-105"
          >
            <House size={20} weight="fill" />
            Home
            <LinkPendingSpinner size={20} weight="bold" />
          </Link>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<ViewIcon size={48} weight="fill" />}
          message={
            query
              ? "No videos found!"
              : "No liked videos yet! Tap the 👍 while watching."
          }
          action={
            query
              ? {
                  label: "Clear search",
                  href: kidsPortalUrl(profileId, feed, { q: "" }),
                }
              : {
                  label: "Find videos",
                  href: kidsPortalUrl(profileId, feed, {
                    view: "videos",
                    channel: null,
                  }),
                }
          }
        />
      ) : (
        <SaveToPlaylistProvider
          profileId={profileId}
          playlists={playlistRows}
        >
          <KidsVideoGrid
            rows={rows}
            profileId={profileId}
            feedQuery={kidsFeedQuery(feed)}
          />
        </SaveToPlaylistProvider>
      )}
    </>
  );
}
