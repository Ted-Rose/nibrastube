"use client";

import { ParentalGateWrapper } from "./parental-gate-wrapper";
import { Button } from "./ui/button";
import { verifyParentPin } from "@/app/actions/safety";
import { LockOpen, LockSimple } from "@phosphor-icons/react";

interface KidsFooterGateProps {
  defaultOpen?: boolean;
  // "footer" is the labelled button on /kids; "icon" is the compact
  // lock button in the kids portal header.
  variant?: "footer" | "icon";
}

export function KidsFooterGate({
  defaultOpen,
  variant = "footer",
}: KidsFooterGateProps) {
  return (
    <ParentalGateWrapper
      defaultOpen={defaultOpen}
      onVerified={async (pin) => {
        const result = await verifyParentPin(pin);
        return result?.error;
      }}
    >
      {variant === "icon" ? (
        <Button
          variant="ghost"
          size="icon-touch"
          aria-label="Parent settings"
          className="text-slate-400 hover:text-primary"
        >
          <LockSimple size={24} weight="bold" className="size-6" />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="touch"
          className="text-slate-400 hover:text-primary gap-2"
        >
          <LockOpen size={20} /> Parent Settings
        </Button>
      )}
    </ParentalGateWrapper>
  );
}
