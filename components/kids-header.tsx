"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface KidsHeaderProps {
  row1: ReactNode;
  tabs: ReactNode;
}

// Below this scroll depth row 1 always stays visible.
const COLLAPSE_AFTER_PX = 64;
// Net directional travel needed to toggle the collapse — a fling
// collapses or restores right away while small jitters don't flap it.
const FLIP_PX = 8;

// Sticky frosted header for the kids portal. `row1` (search, profile
// link, parent gate) and `tabs` arrive as server-rendered slots; this
// shell owns only the surface and the phone-only collapse-on-scroll.
//
// Collapsing translates the whole header up by row 1's measured height —
// a transform only, never height or display. Changing layout would
// scroll-anchor the page and flip the scroll direction, which makes the
// header oscillate. The safe-area padding sits outside the measured row
// so after the transform the tab strip still clears the notch. Row 1 is
// `inert` while hidden so it can't be focused or tapped off-screen, and
// it never collapses while one of its controls (the search input) is
// focused.
export function KidsHeader({ row1, tabs }: KidsHeaderProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [row1Height, setRow1Height] = useState(0);
  const row1Ref = useRef<HTMLDivElement>(null);
  const scroll = useRef({
    lastY: 0,
    downTravel: 0,
    upTravel: 0,
    collapsed: false,
    focused: false,
  });

  useEffect(() => {
    const s = scroll.current;
    s.lastY = window.scrollY;
    const mq = window.matchMedia("(max-width: 639px)");
    let raf = 0;

    const update = () => {
      const y = window.scrollY;
      const delta = y - s.lastY;
      s.lastY = y;
      if (!mq.matches || s.focused) return;
      if (delta > 0) {
        s.downTravel += delta;
        s.upTravel = 0;
      } else if (delta < 0) {
        s.upTravel -= delta;
        s.downTravel = 0;
      }
      let next = s.collapsed;
      if (y <= COLLAPSE_AFTER_PX) {
        next = false;
      } else if (s.downTravel >= FLIP_PX) {
        next = true;
      } else if (s.upTravel >= FLIP_PX) {
        next = false;
      }
      if (next !== s.collapsed) {
        const row1 = row1Ref.current;
        if (next && !row1) return;
        s.collapsed = next;
        if (next && row1) setRow1Height(row1.offsetHeight);
        setCollapsed(next);
      }
    };

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };

    // Rotating to sm+ (or resizing a desktop window) must never strand a
    // hidden row 1; the stale travel counters go too, so a resize can't
    // re-collapse on the first scroll tick.
    const onMqChange = () => {
      s.downTravel = 0;
      s.upTravel = 0;
      if (!mq.matches && s.collapsed) {
        s.collapsed = false;
        setCollapsed(false);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    mq.addEventListener("change", onMqChange);
    return () => {
      window.removeEventListener("scroll", onScroll);
      mq.removeEventListener("change", onMqChange);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // onFocus/onBlur here see row-1 descendants too (React focus events
  // propagate like focusin/focusout). A focused control must stay
  // visible, so focus keeps the row expanded and even restores it.
  const setFocused = (focused: boolean) => {
    const s = scroll.current;
    s.focused = focused;
    s.downTravel = 0;
    s.upTravel = 0;
    s.lastY = window.scrollY;
    if (focused && s.collapsed) {
      s.collapsed = false;
      setCollapsed(false);
    }
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-10 border-b border-slate-200/70 bg-white/85",
        "backdrop-blur-md transition-transform duration-200 ease-out",
        "motion-reduce:transition-none"
      )}
      style={{
        transform: collapsed
          ? `translateY(-${row1Height}px)`
          : undefined,
      }}
    >
      <div className="mx-auto max-w-7xl px-4 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-6">
        <div
          ref={row1Ref}
          // Deliberate trade-off: while collapsed the row-1 controls
          // leave the a11y tree and tab order — they're translated
          // off-screen, so keeping them focusable would be worse.
          // Scrolling up (or focusing search) restores them.
          inert={collapsed}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="flex items-center gap-2 py-2 sm:gap-3"
        >
          {row1}
        </div>
        {tabs}
      </div>
    </header>
  );
}
