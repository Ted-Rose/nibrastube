import { createElement } from "react";
import type { ReactNode } from "react";
import type { Icon } from "@phosphor-icons/react";
// kidsPortalUrl/lenRangeLabel are pure functions, but kids-feed.ts
// also imports the db client — server components only.
import {
  kidsPortalUrl,
  lenRangeLabel,
  type KidsFeedParams,
} from "@/lib/kids-feed";

// One copy+CTA choice in the decision chain — `overrides` are
// kidsPortalUrl params, so branch links can't drop live feed params.
interface EmptyBranch {
  when: boolean;
  message: string;
  action?: {
    label: string;
    overrides: Partial<KidsFeedParams>;
  };
}

// One case inside the active-filter branch: "shorts"/"videos" match
// feed.type; "band" matches a ?min/?max bound and gets lenRangeLabel's
// output. First matching case wins — array order IS the precedence
// (most views check type before the band; History checks the band
// before its "videos" copy).
type FilteredCopy =
  | { type: "shorts" | "videos"; message: string }
  | { type: "band"; message: (lenLabel: string) => string };

// The empty-state decision every kids feed view used to re-implement
// as a ternary chain, evaluated top to bottom:
//   1. feed.q           → "No <noun> found!" + "Clear search"
//   2. beforeFilters    → view-specific (History's ?date= case)
//   3. filters active   → `filtered` copy + "Show everything"
//      (?type=/?min=/?max=)
//   4. afterFilters     → view-specific (the drill-in's "Videos are on
//      the way!" when the channel is approved but still empty)
//   5. `empty`          → the view's plain empty copy + optional CTA
// Returns EmptyState props verbatim — <EmptyState {...emptyStateFor()} />.
export function emptyStateFor({
  feed,
  profileId,
  icon,
  noun,
  filtered,
  extra,
  empty,
}: {
  feed: KidsFeedParams;
  profileId: string;
  // Rendered at the shared 48px fill size EmptyState icons use.
  icon: Icon;
  // Noun for the search branch: "No <noun> found!".
  noun: string;
  // Copy for the filter branch — a flat string for views that don't
  // differentiate, or cases in precedence order.
  filtered?: FilteredCopy[] | string;
  extra?: {
    beforeFilters?: EmptyBranch;
    afterFilters?: EmptyBranch;
  };
  empty: { message: string; action?: EmptyBranch["action"] };
}): {
  icon: ReactNode;
  message: string;
  action?: { label: string; href: string };
} {
  const link = (action: EmptyBranch["action"]) =>
    action && {
      label: action.label,
      href: kidsPortalUrl(profileId, feed, action.overrides),
    };
  const branch = (b?: EmptyBranch) =>
    b && b.when
      ? { message: b.message, action: link(b.action) }
      : undefined;

  const filtersActive =
    feed.type !== "all" ||
    feed.minLen !== null ||
    feed.maxLen !== null;
  let filteredMessage: string | undefined;
  if (typeof filtered === "string") {
    filteredMessage = filtered;
  } else {
    for (const c of filtered ?? []) {
      const hit =
        c.type === "band"
          ? feed.minLen !== null || feed.maxLen !== null
          : feed.type === c.type;
      if (!hit) continue;
      filteredMessage =
        c.type === "band"
          ? c.message(lenRangeLabel(feed.minLen, feed.maxLen))
          : c.message;
      break;
    }
  }

  const resolved =
    (feed.q
      ? {
          message: `No ${noun} found!`,
          action: link({ label: "Clear search", overrides: { q: "" } }),
        }
      : undefined) ??
    branch(extra?.beforeFilters) ??
    (filtersActive
      ? {
          message: filteredMessage ?? empty.message,
          action: link({
            label: "Show everything",
            overrides: { type: "all", minLen: null, maxLen: null },
          }),
        }
      : undefined) ??
    branch(extra?.afterFilters) ?? {
      message: empty.message,
      action: link(empty.action),
    };

  return {
    icon: createElement(icon, { size: 48, weight: "fill" }),
    message: resolved.message,
    action: resolved.action,
  };
}
