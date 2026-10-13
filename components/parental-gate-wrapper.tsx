"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ParentalGate } from "./parental-gate";
import { Button } from "./ui/button";
import { Lock, SpinnerGap } from "@phosphor-icons/react";

interface ParentalGateWrapperProps {
  children: React.ReactNode;
  triggerText?: string;
  className?: string;
  // Auto-open the modal on mount (e.g. /kids?gate=1 after a /parent/*
  // bounce). Remount via `key` to re-trigger on same-page navigations.
  defaultOpen?: boolean;
  // Server action that verifies the entered PIN; returning an error
  // message keeps the gate open and shows it inside the modal.
  onVerified?: (pin: string) => Promise<string | void> | string | void;
}

// The overlays portal to document.body: rendered inline inside the kids
// header, its backdrop-filter and collapse transform make the header
// the containing block for fixed descendants, so the modal would be
// clipped to the header strip. `isOpen` can be true during SSR (?gate=1
// passes defaultOpen from the server), so the portal can't gate on
// isOpen alone — the mounted flag below reads false on the server and
// during hydration, then flips client-side with no mismatch.
const subscribeMounted = () => () => {};
const getMounted = () => true;
const getUnmounted = () => false;

export function ParentalGateWrapper({ children, triggerText, className, defaultOpen, onVerified }: ParentalGateWrapperProps) {
  const [isOpen, setIsOpen] = useState(!!defaultOpen);
  const [verifying, setVerifying] = useState(false);
  const mounted = useSyncExternalStore(
    subscribeMounted,
    getMounted,
    getUnmounted,
  );

  // onVerified is an async server action that checks the PIN and
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
        // Server-side check failed — drop the overlay so the error
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
      {mounted &&
        verifying &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center"
          >
            <SpinnerGap size={48} className="animate-spin text-white" />
          </div>,
          document.body,
        )}
      {isOpen ? (
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm">
              <ParentalGate
                onPass={handlePass}
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
          </div>,
          document.body,
        )
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
