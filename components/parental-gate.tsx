"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

interface ParentalGateProps {
  // Receives the entered PIN; may return an error message (e.g. a
  // server-side re-check failed) to keep the gate open and show it.
  onPass: (pin: string) => string | void | Promise<string | void>;
  onFail?: () => void;
  correctPin: string;
  title?: string;
  description?: string;
}

export function ParentalGate({ onPass, onFail, correctPin, title, description }: ParentalGateProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === correctPin) {
      const errorMessage = await onPass(pin);
      if (typeof errorMessage === "string") {
        setError(errorMessage);
        setPin("");
      }
    } else {
      setError("Incorrect PIN. Try again.");
      setPin("");
      if (onFail) onFail();
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
          <Button type="submit" className="w-full h-12 text-lg">Unlock Settings</Button>
        </form>
      </CardContent>
    </Card>
  );
}
