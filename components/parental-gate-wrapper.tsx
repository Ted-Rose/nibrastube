"use client";

import { useState } from "react";
import { ParentalGate } from "./parental-gate";
import { Button } from "./ui/button";
import { Lock } from "@phosphor-icons/react";

interface ParentalGateWrapperProps {
  children: React.ReactNode;
  triggerText?: string;
  className?: string;
  defaultOpen?: boolean;
}

export function ParentalGateWrapper({ children, triggerText, className, defaultOpen }: ParentalGateWrapperProps) {
  const [isOpen, setIsOpen] = useState(!!defaultOpen);

  if (isOpen) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div className="w-full max-w-sm">
          <ParentalGate
            title="Parental Control"
            description="Enter your PIN to unlock parent settings."
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
