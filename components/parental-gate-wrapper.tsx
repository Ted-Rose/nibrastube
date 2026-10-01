"use client";

import { useState } from "react";
import { ParentalGate } from "./parental-gate";
import { Button } from "./ui/button";
import { Lock, LockOpen } from "@phosphor-icons/react";

interface ParentalGateWrapperProps {
  children: React.ReactNode;
  correctPin: string;
  triggerText?: string;
  className?: string;
  onVerified?: () => void;
}

export function ParentalGateWrapper({ children, correctPin, triggerText, className, onVerified }: ParentalGateWrapperProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (isOpen) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div className="w-full max-w-sm">
          <ParentalGate 
            correctPin={correctPin}
            onPass={() => {
              setIsOpen(false);
              if (onVerified) onVerified();
            }} 
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
    <div className={className} onClick={() => setIsOpen(true)}>
      {children || (
        <Button variant="outline" className="gap-2">
          <Lock /> {triggerText || "Parental Gate"}
        </Button>
      )}
    </div>
  );
}
