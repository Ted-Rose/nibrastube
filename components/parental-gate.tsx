"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { SpinnerGap } from "@phosphor-icons/react";

interface ParentalGateProps {
  // Receives the entered PIN for server-side verification; may return
  // an error message to keep the gate open and show it. The PIN is
  // never checked client-side — it stays off this component entirely.
  onPass: (pin: string) => string | void | Promise<string | void>;
  title?: string;
  description?: string;
}

export function ParentalGate({ onPass, title, description }: ParentalGateProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const errorMessage = await onPass(pin);
      if (typeof errorMessage === "string") {
        setError(errorMessage);
        setPin("");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="w-full max-w-sm mx-auto shadow-2xl border-4 border-primary/20 bg-background/95 backdrop-blur">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold">{title || "Parental Control"}</CardTitle>
        <CardDescription>{description || "Enter your 4-digit Parent PIN to continue."}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="text-center space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pin" className="sr-only">Parent PIN</Label>
              <Input
                id="pin"
                name="pin"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                placeholder="****"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className={`text-center text-3xl h-16 tracking-[1em] font-mono ${error ? "border-destructive ring-destructive" : ""}`}
                autoFocus
                required
              />
              {error && <p className="text-destructive text-sm font-bold">{error}</p>}
            </div>
          </div>
          <Button type="submit" className="w-full h-12 text-lg" disabled={pending}>
            {pending ? (
              <>
                <SpinnerGap className="animate-spin" />
                Checking…
              </>
            ) : (
              "Unlock Settings"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
