"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { SpinnerGap } from "@phosphor-icons/react";
import { verifyParentPin } from "@/app/actions/safety";

interface ParentalGateProps {
  title?: string;
  description?: string;
}

export function ParentalGate({ title, description }: ParentalGateProps) {
  const [pin, setPin] = useState("");
  // Wrap the action so the input clears on each failed attempt (a
  // successful verify redirects away, so a return means failure)
  const [state, formAction, pending] = useActionState(
    async (prev: { error?: string } | null, formData: FormData) => {
      const result = await verifyParentPin(prev, formData);
      setPin("");
      return result;
    },
    null
  );

  return (
    <Card className="w-full max-w-sm mx-auto shadow-2xl border-4 border-primary/20 bg-background/95 backdrop-blur">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold">{title || "Parental Control"}</CardTitle>
        <CardDescription>{description || "Enter your 4-digit Parent PIN to continue."}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-6">
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
                className={`text-center text-3xl h-16 tracking-[1em] font-mono ${state?.error ? "border-destructive ring-destructive" : ""}`}
                autoFocus
                required
              />
              {state?.error && <p className="text-destructive text-sm font-bold">{state.error}</p>}
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
