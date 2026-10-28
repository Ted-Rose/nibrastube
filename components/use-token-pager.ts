import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

// Page fields that carry "already flagged" ids — video pages return
// pinnedIds, channel pages approvedIds. `flagKeys` lists which fields
// each caller unions into flaggedIds.
export type TokenPagerFlagKey = "pinnedIds" | "approvedIds";

export interface TokenPagerPage<T> {
  items: T[];
  nextPageToken: string | null;
  pinnedIds?: string[];
  approvedIds?: string[];
}

// Layout effect on the client, plain effect during SSR (layout
// effects don't run there). The stale-fetch generation bump must land
// in the same commit as the fresh first page — a passive effect would
// leave a microtask window where an in-flight loadMore could still
// append a stale page over the reset.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

// Token-keyed infinite scroll shared by the dashboard's search grid
// and channel drill-in uploads — same accumulation model as
// kids-video-grid.tsx but keyed on YouTube's opaque page token instead
// of a row offset. Exhaustion is `nextPageToken == null`, never an
// empty page (a hydrated page can filter to zero usable cards while a
// token remains — the sentinel stays alive so the observer re-fires
// or the user clicks). `rootMargin` stays per caller — it encodes the
// quota cost of a page (100 units per search page vs 1 per uploads
// page).
export function useTokenPager<T extends { id: string }>({
  initialItems,
  initialFlaggedIds,
  initialNextPageToken,
  loadMore,
  flagKeys,
  rootMargin,
}: {
  initialItems: T[];
  // Ids already flagged for the profile — the union with each
  // appended page's flag list renders correct flagged state without a
  // refresh.
  initialFlaggedIds: string[];
  initialNextPageToken: string | null;
  loadMore?: (
    pageToken: string | null
  ) => Promise<TokenPagerPage<T>>;
  flagKeys: readonly TokenPagerFlagKey[];
  rootMargin: string;
}) {
  const [items, setItems] = useState(initialItems);
  const [flaggedIds, setFlaggedIds] = useState(
    () => new Set(initialFlaggedIds)
  );
  const [nextToken, setNextToken] = useState(initialNextPageToken);
  const [fetching, setFetching] = useState(false);
  // A failed fetch pauses the observer (no auto-retry loop) but keeps
  // the sentinel's button as a manual retry.
  const [failed, setFailed] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Generation counter the reset invalidates: fetchNext captures it
  // before loadMore and .then/.catch/.finally bail if it changed
  // mid-flight, so a stale page can neither append over the fresh
  // first page nor corrupt failed/fetching for a newer fetch. Bumped
  // in the commit (not during render — refs are render-pure) so it
  // also can't trip on a discarded concurrent render.
  const generationRef = useRef(0);
  useIsomorphicLayoutEffect(() => {
    generationRef.current += 1;
  }, [initialItems]);
  const hasMore = !!loadMore && nextToken != null;

  // A server refresh (new search, pin revalidation, tab switch) swaps
  // in a fresh first page — drop appended pages and restart from it.
  // Same accepted tradeoff as the kids feed's prevInitial reset.
  const [prevInitial, setPrevInitial] = useState(initialItems);
  if (prevInitial !== initialItems) {
    setPrevInitial(initialItems);
    setItems(initialItems);
    setFlaggedIds(new Set(initialFlaggedIds));
    setNextToken(initialNextPageToken);
    setFetching(false);
    setFailed(false);
  }

  const fetchNext = useCallback(() => {
    if (!loadMore || fetching || nextToken == null) return;
    setFetching(true);
    const generation = generationRef.current;
    loadMore(nextToken)
      .then((page) => {
        // A reset landed mid-flight — this page belongs to the old
        // first page's token chain.
        if (generation !== generationRef.current) return;
        // YouTube ranking drifts between pages — dedup by id so a
        // shifted result never mounts twice.
        setItems((prev) => {
          const seen = new Set(prev.map((v) => v.id));
          return [
            ...prev,
            ...page.items.filter((v) => !seen.has(v.id)),
          ];
        });
        setFlaggedIds((prev) => {
          const next = new Set(prev);
          for (const key of flagKeys) {
            for (const id of page[key] ?? []) next.add(id);
          }
          return next;
        });
        setNextToken(page.nextPageToken);
      })
      .catch(() => {
        if (generation !== generationRef.current) return;
        setFailed(true);
      })
      .finally(() => {
        if (generation === generationRef.current) setFetching(false);
      });
  }, [loadMore, fetching, nextToken, flagKeys]);

  const showMore = useCallback(() => {
    setFailed(false);
    fetchNext();
  }, [fetchNext]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || failed) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) showMore();
      },
      { rootMargin }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, failed, showMore, rootMargin]);

  return {
    items,
    flaggedIds,
    hasMore,
    fetching,
    failed,
    sentinelRef,
    showMore,
  };
}
