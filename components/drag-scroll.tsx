"use client";

import { useEffect } from "react";

// Pixels of travel before a press counts as a drag — under it the
// pointerup falls through as a normal click on the card/chip.
const DRAG_THRESHOLD = 5;

/**
 * Invisible component: gives every element tagged `data-drag-scroll`
 * desktop mouse drag-to-scroll — the shelf rows and filter chip strips
 * already swipe on touch and scroll on trackpads, but a mouse could
 * only click them. Pointer events are delegated on window so server
 * components only need the attribute, no client wrapper.
 *
 * While dragging: scroll-snap is switched off (snap-mandatory would
 * otherwise fight every scrollLeft step and snap back), the cursor
 * flips to grabbing, and body user-select is cleared so text doesn't
 * highlight under the pointer. On release the follow-up click is
 * swallowed so a drag never navigates the card it started on.
 */
export function DragScroll() {
  useEffect(() => {
    let container: HTMLElement | null = null;
    let pointerId = -1;
    let startX = 0;
    let startLeft = 0;
    let dragging = false;
    let suppressClick = false;

    // Elements with their own pointer-drag meaning (the length
    // filter's slider thumbs, form fields) opt out — dragging them
    // must not scroll the row behind them.
    const SKIP = "input, textarea, select, [contenteditable], [data-slot=slider], [data-no-drag-scroll]";

    const reset = () => {
      if (container) {
        container.style.removeProperty("scroll-snap-type");
      }
      document.documentElement.classList.remove("drag-scroll-active");
      document.body.style.removeProperty("user-select");
      container = null;
      pointerId = -1;
      dragging = false;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !e.isPrimary || e.button !== 0)
        return;
      if (!(e.target instanceof HTMLElement)) return;
      if (e.target.closest(SKIP)) return;
      // A pointercancel leaves the flag armed but fires no click —
      // a fresh press means the next click is legitimate again.
      suppressClick = false;
      // Closest tagged ancestor that can actually scroll — an
      // inner strip that fits its content (e.g. the sort chips nav
      // inside a wider actions row) falls through to the outer row.
      let el = e.target.closest<HTMLElement>("[data-drag-scroll]");
      while (el && el.scrollWidth <= el.clientWidth + 1) {
        el = el.parentElement?.closest<HTMLElement>(
          "[data-drag-scroll]"
        ) ?? null;
      }
      if (!el) return;
      container = el;
      pointerId = e.pointerId;
      startX = e.clientX;
      startLeft = el.scrollLeft;
      dragging = false;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!container || e.pointerId !== pointerId) return;
      // Released outside the window: no pointerup arrives, so drop
      // the stale gesture instead of scrolling on a free-floating
      // pointer.
      if ((e.buttons & 1) === 0) {
        reset();
        return;
      }
      const dx = e.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) <= DRAG_THRESHOLD) return;
        dragging = true;
        // Capture keeps move/up events flowing when the pointer
        // leaves the window mid-drag.
        try {
          container.setPointerCapture(e.pointerId);
        } catch {
          // Pointer already released — the gesture continues
          // fine without capture.
        }
        container.style.scrollSnapType = "none";
        // Class on <html>, not a style on the container — the cards'
        // UA cursor:pointer would otherwise win over descendants.
        document.documentElement.classList.add("drag-scroll-active");
        document.body.style.userSelect = "none";
        window.getSelection()?.removeAllRanges();
      }
      // Cancelling the pointermove cancels its compatibility
      // mousemove too, so no text selection grows while dragging.
      e.preventDefault();
      container.scrollLeft = startLeft - dx;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!container || e.pointerId !== pointerId) return;
      if (dragging) suppressClick = true;
      reset();
    };

    // A real drag must not activate whatever the press landed on —
    // swallow the trailing click in the capture phase, before the
    // card's own handler (Link navigation, ⋮ menu) sees it.
    const onClick = (e: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    };

    // Without this, pressing on a card thumbnail would begin the
    // browser's native image drag instead of scrolling the row.
    const onDragStart = (e: DragEvent) => {
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("[data-drag-scroll]")
      ) {
        e.preventDefault();
      }
    };

    // pointerdown/up and click listen in the capture phase so a
    // nested handler that stops propagation can't hide them.
    window.addEventListener("pointerdown", onPointerDown, true);
    // Non-passive so the handler can preventDefault selection.
    window.addEventListener("pointermove", onPointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    window.addEventListener("click", onClick, true);
    document.addEventListener("dragstart", onDragStart, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      window.removeEventListener("click", onClick, true);
      document.removeEventListener("dragstart", onDragStart, true);
      reset();
    };
  }, []);

  return null;
}
