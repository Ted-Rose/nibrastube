"use client";

import { ParentalGateWrapper } from "./parental-gate-wrapper";
import { Button } from "./ui/button";
import { LockOpen } from "@phosphor-icons/react";

interface KidsFooterGateProps {
  defaultOpen?: boolean;
}

export function KidsFooterGate({ defaultOpen }: KidsFooterGateProps) {
  return (
    <ParentalGateWrapper defaultOpen={defaultOpen}>
      <Button
        variant="ghost"
        size="touch"
        className="text-slate-400 hover:text-primary gap-2"
      >
        <LockOpen size={20} /> Parent Settings
      </Button>
    </ParentalGateWrapper>
  );
}
