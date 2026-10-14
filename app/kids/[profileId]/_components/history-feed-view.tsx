import { EmptyState } from "@/components/empty-state";
import { HistoryDatePicker } from "@/components/history-date-picker";
import { HistoryView } from "@/components/history-view";
import {
  getWatchHistory,
  kidsFeedQuery,
  kidsPortalUrl,
  type KidsFeedParams,
} from "@/lib/kids-feed";
import { FeedHeader } from "@/components/feed-header";
import { feedTitle, KIDS_VIEWS } from "./view-config";

// History tab — day-grouped watch history, optionally filtered to one
// kid-local day via ?date=.
export async function HistoryFeedView({
  profileId,
  feed,
}: {
  profileId: string;
  feed: KidsFeedParams;
}) {
  const { q: query } = feed;

  // Day-grouped watch history — carries watchedOn/lastSeenAt on top of the
  // usual { video, progress, reaction } row shape.
  const rows = await getWatchHistory(profileId, {
    q: query,
    date: feed.date ?? undefined,
  });
  const ViewIcon = KIDS_VIEWS.history.icon;

  let emptyMessage = "Watch a video and it'll show up here!";
  let emptyAction: { label: string; href: string } = {
    label: "Find videos",
    href: kidsPortalUrl(profileId, feed, { view: "videos", channel: null }),
  };
  if (query) {
    emptyMessage = "No videos found!";
    emptyAction = {
      label: "Clear search",
      href: kidsPortalUrl(profileId, feed, { q: "" }),
    };
  } else if (feed.date) {
    emptyMessage = "Nothing watched that day!";
    emptyAction = {
      label: "All days",
      href: kidsPortalUrl(profileId, feed, { date: null }),
    };
  }

  return (
    <>
      <FeedHeader
        title={feedTitle(feed)}
        actions={<HistoryDatePicker date={feed.date} />}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<ViewIcon size={48} weight="fill" />}
          message={emptyMessage}
          action={emptyAction}
        />
      ) : (
        <HistoryView
          rows={rows}
          profileId={profileId}
          feedQuery={kidsFeedQuery(feed)}
        />
      )}
    </>
  );
}
