import { EmptyState } from "@/components/empty-state";
import { HistoryDatePicker } from "@/components/history-date-picker";
import { KidsLengthFilter } from "@/components/kids-length-filter";
import { KidsTypeFilter } from "@/components/kids-type-filter";
import { HistoryView } from "@/components/history-view";
import {
  getWatchHistory,
  kidsFeedQuery,
  type KidsFeedParams,
} from "@/lib/kids-feed";
import { emptyStateFor } from "@/lib/empty-state";
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

  const empty = emptyStateFor({
    feed,
    profileId,
    icon: ViewIcon,
    noun: "videos",
    extra: {
      beforeFilters: {
        when: !!feed.date,
        message: "Nothing watched that day!",
        action: { label: "All days", overrides: { date: null } },
      },
    },
    filtered: [
      { type: "shorts", message: "No shorts watched yet!" },
      {
        type: "band",
        message: (l) => `No videos ${l} watched yet!`,
      },
      { type: "videos", message: "No videos watched yet!" },
    ],
    empty: {
      message: "Watch a video and it'll show up here!",
      action: {
        label: "Find videos",
        overrides: { view: "videos", channel: null },
      },
    },
  });

  return (
    <>
      <FeedHeader
        title={feedTitle(feed)}
        actions={
          <div
            data-drag-scroll
            className="flex max-w-full flex-nowrap items-center gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <KidsTypeFilter profileId={profileId} feed={feed} />
            <KidsLengthFilter minLen={feed.minLen} maxLen={feed.maxLen} />
            <HistoryDatePicker date={feed.date} />
          </div>
        }
      />

      {rows.length === 0 ? (
        <EmptyState {...empty} />
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
