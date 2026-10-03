"use client";

import { useState } from "react";
import { ParentalGate } from "./parental-gate";
import { Button } from "./ui/button";
import { Lock, LockOpen, SpinnerGap } from "@phosphor-icons/react";

interface ParentalGateWrapperProps {
  children: React.ReactNode;
  correctPin: string;
  triggerText?: string;
  className?: string;
  onVerified?: () => void | Promise<void>;
}

export function ParentalGateWrapper({ children, correctPin, triggerText, className, onVerified }: ParentalGateWrapperProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // onVerified may be an async server action that redirects — keep a
  // full-screen spinner up until it settles so the user isn't left
  // staring at the kids page with no feedback.
  const handlePass = async () => {
    setIsOpen(false);
    if (!onVerified) return;
    setVerifying(true);
    try {
      await onVerified();
    } finally {
      setVerifying(false);
    }
  };

  if (isOpen) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div className="w-full max-w-sm">
          <ParentalGate 
            correctPin={correctPin}
            onPass={handlePass} 
            onFail={() => setIsOpen(false)}
            title="Parental Control"
            description="Solving this will unlock restricted options."
          />
          <Button 
            variant="ghost" 
            className="w-full mt-4 h-10 text-white hover:bg-white/10" 
            onClick={() => setIsOpen(false)}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      {verifying && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
          <SpinnerGap size={48} className="animate-spin text-white" />
        </div>
      )}
      <div className={className} onClick={() => setIsOpen(true)}>
        {children || (
          <Button variant="outline" className="gap-2">
            <Lock /> {triggerText || "Parental Gate"}
          </Button>
        )}
      </div>
    </>
  );
}
