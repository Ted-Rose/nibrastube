import { EmptyState } from "@/components/empty-state";
import { HistoryDatePicker } from "@/components/history-date-picker";
import { KidsLengthFilter } from "@/components/kids-length-filter";
import { KidsTypeFilter } from "@/components/kids-type-filter";
import { HistoryView } from "@/components/history-view";
import {
  getWatchHistory,
  kidsFeedQuery,
  kidsPortalUrl,
  lenRangeLabel,
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
    type: feed.type,
    minLen: feed.minLen,
    maxLen: feed.maxLen,
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
  } else if (
    feed.type !== "all" ||
    feed.minLen !== null ||
    feed.maxLen !== null
  ) {
    emptyMessage =
      feed.type === "shorts"
        ? "No shorts watched yet!"
        : feed.minLen !== null || feed.maxLen !== null
          ? `No videos ${lenRangeLabel(feed.minLen, feed.maxLen)} watched yet!`
          : "No videos watched yet!";
    emptyAction = {
      label: "Show everything",
      href: kidsPortalUrl(profileId, feed, {
        type: "all",
        minLen: null,
        maxLen: null,
      }),
    };
  }

  return (
    <>
      <FeedHeader
        title={feedTitle(feed)}
        actions={
          <div className="flex max-w-full flex-nowrap items-center gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <KidsTypeFilter profileId={profileId} feed={feed} />
            <KidsLengthFilter minLen={feed.minLen} maxLen={feed.maxLen} />
            <HistoryDatePicker date={feed.date} />
          </div>
        }
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
