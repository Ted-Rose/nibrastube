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
  // Receives the entered PIN after the client-side check; returning an
  // error message keeps the gate open and shows it inside the modal.
  onVerified?: (pin: string) => Promise<string | void> | string | void;
}

export function ParentalGateWrapper({ children, correctPin, triggerText, className, onVerified }: ParentalGateWrapperProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // onVerified is an async server action that re-checks the PIN and
  // usually redirects — keep a full-screen spinner up while it runs so
  // the user isn't left staring at a frozen gate modal. On success the
  // spinner stays up deliberately: the redirect unmounts us anyway, and
  // clearing it first would flash the kids page for a tick before
  // navigation.
  const handlePass = async (enteredPin: string) => {
    if (!onVerified) {
      setIsOpen(false);
      return;
    }
    setVerifying(true);
    try {
      const error = await onVerified(enteredPin);
      if (error) {
        // Server-side re-check failed — drop the overlay so the error
        // can surface inside the still-open gate.
        setVerifying(false);
        return error;
      }
      setIsOpen(false);
    } catch {
      setVerifying(false);
    }
  };

  return (
    <>
      {verifying && (
        <div role="status" aria-live="polite" className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center">
          <SpinnerGap size={48} className="animate-spin text-white" />
        </div>
      )}
      {isOpen ? (
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
      ) : (
        <div className={className} onClick={() => setIsOpen(true)}>
          {children || (
            <Button variant="outline" className="gap-2">
              <Lock /> {triggerText || "Parental Gate"}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
