"use client";

import { ParentalGateWrapper } from "./parental-gate-wrapper";
import { Button } from "./ui/button";
import { unlockParentPortal } from "@/app/actions/safety";
import { LockOpen } from "@phosphor-icons/react";

interface KidsFooterGateProps {
  correctPin: string;
}

export function KidsFooterGate({ correctPin }: KidsFooterGateProps) {
  return (
    <ParentalGateWrapper
      correctPin={correctPin}
      onVerified={async () => {
         await unlockParentPortal();
      }}
    >
      <Button variant="ghost" className="text-slate-400 hover:text-primary gap-2">
        <LockOpen size={20} /> Parent Settings
      </Button>
    </ParentalGateWrapper>
  );
}
