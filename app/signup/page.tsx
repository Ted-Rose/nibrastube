import { SignupForm } from "@/components/signup-form";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ callback?: string }> }) {
  const { callback } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md shadow-2xl">
        <CardHeader className="space-y-1">
          <CardTitle className="text-3xl font-bold tracking-tight text-center">Create an account</CardTitle>
          <CardDescription className="text-center">
            Enter your details to create your parent portal account
          </CardDescription>
        </CardHeader>
        <SignupForm callback={callback} />
      </Card>
    </div>
  );
}
