"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { SwipeDirection } from "@/lib/gestures";

interface SwipeConfirmDialogProps {
  direction: SwipeDirection;
  targetTitle?: string;
  onConfirm: (dontAskAgain: boolean) => void;
  onCancel: () => void;
}

// Shown until the kid checks "Don't ask me again". Renders inside
// <FullscreenPlayer> so it covers the player box (swipes only start
// inline — the embed's own fullscreen renders just the iframe). "Keep
// watching" is the default-focused safe choice for accidental swipes.
export function SwipeConfirmDialog({
  direction,
  targetTitle,
  onConfirm,
  onCancel,
}: SwipeConfirmDialogProps) {
  const [dontAskAgain, setDontAskAgain] = useState(false);

  // Escape and a click on the dimmed backdrop both take the safe
  // "Keep watching" path — same as the focused default button (the
  // caller's cancel releases the nav guard it latched on swipe).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      className={cn(
        "absolute inset-0 z-50 flex items-center justify-center",
        "bg-black/70 p-4"
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <Card className="w-full max-w-md rounded-[32px] border-4 border-primary/20 bg-background shadow-2xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-black">
            Switch video?
          </CardTitle>
          {targetTitle && (
            <CardDescription className="line-clamp-2 text-base">
              {direction === "next" ? "Next" : "Back"}: {targetTitle}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-center gap-3">
            <input
              id="swipe-dont-ask"
              type="checkbox"
              checked={dontAskAgain}
              onChange={(e) => setDontAskAgain(e.target.checked)}
              className="h-5 w-5 accent-primary"
            />
            <Label htmlFor="swipe-dont-ask" className="text-sm">
              Don&apos;t ask me again
            </Label>
          </div>
          <div className="flex flex-col gap-3">
            <Button
              size="touch"
              className="w-full text-lg font-bold"
              onClick={onCancel}
              autoFocus
            >
              Keep watching
            </Button>
            <Button
              variant="outline"
              size="touch"
              className="w-full text-lg font-bold"
              onClick={() => onConfirm(dontAskAgain)}
            >
              Yes, switch
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
