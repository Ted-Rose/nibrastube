"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export function FullscreenPlayer({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Once the user deliberately leaves fullscreen, stop auto-requesting it —
  // otherwise every subsequent tap re-enters fullscreen and traps them.
  const userExitedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || document.fullscreenElement) return;

    const requestFs = () => {
      if (userExitedRef.current) return;
      // iOS/Safari PWA doesn't support fullscreen on arbitrary elements —
      // fall back to a CSS overlay that fills the viewport.
      if (!el.requestFullscreen) {
        setPseudoFullscreen(true);
        return;
      }
      Promise.resolve(el.requestFullscreen()).catch(() =>
        setPseudoFullscreen(true)
      );
    };

    requestFs();

    // Browsers require a user gesture for fullscreen, so retry on
    // interaction if the automatic request was rejected.
    const onInteract = () => {
      if (!document.fullscreenElement) requestFs();
    };

    const onFsChange = () => {
      if (document.fullscreenElement) {
        setIsFullscreen(true);
        setPseudoFullscreen(false);
      } else {
        setIsFullscreen(false);
        userExitedRef.current = true;
      }
    };

    window.addEventListener("pointerdown", onInteract);
    window.addEventListener("keydown", onInteract);
    document.addEventListener("fullscreenchange", onFsChange);

    return () => {
      window.removeEventListener("pointerdown", onInteract);
      window.removeEventListener("keydown", onInteract);
      document.removeEventListener("fullscreenchange", onFsChange);
    };
  }, []);

  // Prevent the page behind the overlay from scrolling
  useEffect(() => {
    if (!pseudoFullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [pseudoFullscreen]);

  return (
    <div
      ref={ref}
      className={cn(
        "w-full bg-slate-900 overflow-hidden group",
        pseudoFullscreen
          ? "fixed inset-0 z-50 h-full"
          : "relative max-w-6xl aspect-video rounded-[32px] shadow-2xl border-4 border-slate-800",
        "fullscreen:max-w-none fullscreen:aspect-auto fullscreen:h-full fullscreen:rounded-none fullscreen:border-0"
      )}
    >
      {children}
      {(pseudoFullscreen || isFullscreen) && (
        <button
          onClick={() => {
            userExitedRef.current = true;
            setPseudoFullscreen(false);
            if (document.fullscreenElement) document.exitFullscreen();
          }}
          aria-label="Exit fullscreen"
          className="absolute top-3 left-3 z-50 w-11 h-11 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
        >
          <X size={22} weight="bold" />
        </button>
      )}
    </div>
  );
}
