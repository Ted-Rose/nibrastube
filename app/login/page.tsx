import { LoginForm } from "@/components/login-form";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callback?: string }> }) {
  const { callback } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md shadow-2xl">
        <CardHeader className="space-y-1">
          <CardTitle className="text-3xl font-bold tracking-tight text-center">Log in</CardTitle>
          <CardDescription className="text-center">
            Enter your email and password to access your parent portal
          </CardDescription>
        </CardHeader>
        <LoginForm callback={callback} />
      </Card>
    </div>
  );
}
