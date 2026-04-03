import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { resolveRequestAuth } from "@/server/lib/auth";

export default async function SignUpPage() {
  const auth = await resolveRequestAuth();
  if (auth.authUserId) {
    redirect("/buildings");
  }

  return (
    <AuthShell
      eyebrow="Benchmarking operations"
      title="Get ready for DC benchmarking"
      description="Create your free Quoin account to organize utility data and prepare for Portfolio Manager."
      footer=""
    >
        <SignUpForm />
    </AuthShell>
  );
}
