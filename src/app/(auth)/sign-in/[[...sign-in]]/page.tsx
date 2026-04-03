import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form";
import { resolveRequestAuth } from "@/server/lib/auth";

export default async function SignInPage() {
  const auth = await resolveRequestAuth();
  if (auth.authUserId) {
    redirect("/buildings");
  }

  return (
    <AuthShell
      eyebrow="Secure sign-in"
      title="Return to your benchmarking workspace"
      description="Access Quoin to review readiness, manage Portfolio Manager setup, and advance evidence-backed benchmarking work without losing operational context."
      footer="Sign in with the email and password tied to your Quoin workspace."
    >
        <SignInForm />
    </AuthShell>
  );
}
