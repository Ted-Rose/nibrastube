"use client";

import { useLinkStatus } from "next/link";
import { SpinnerGap, type IconWeight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface LinkPendingSpinnerProps {
  size?: number;
  weight?: IconWeight;
  className?: string;
  // Rendered instead of the spinner while no navigation is pending —
  // pass the slot's normal icon here to swap icon ↔ spinner in place.
  fallback?: ReactNode;
}

// Pending indicator for <Link> navigations that only change
// ?searchParams — the segment's loading.tsx never fires for those, so
// useLinkStatus (which tracks the enclosing link's navigation state) is
// the only signal. Must be rendered inside a <Link>.
export function LinkPendingSpinner({
  size,
  weight,
  className,
  fallback,
}: LinkPendingSpinnerProps) {
  const { pending } = useLinkStatus();
  if (!pending) return <>{fallback ?? null}</>;
  return (
    <SpinnerGap
      size={size}
      weight={weight}
      className={cn("animate-spin", className)}
    />
  );
}
