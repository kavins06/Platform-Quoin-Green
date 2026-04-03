import { redirect } from "next/navigation";
import { resolveRequestAuth } from "@/server/lib/auth";

export default async function OnboardingLayout({
 children,
}: {
 children: React.ReactNode;
}) {
 const auth = await resolveRequestAuth();
 if (!auth.authUserId) redirect("/sign-in");

 return (
 <div className="min-h-screen bg-zinc-100 selection:bg-zinc-200">
 <header className="sticky top-0 z-50 flex h-14 items-center border-b border-zinc-200 bg-white/95 px-6 backdrop-blur-sm">
 <span className="text-lg font-bold tracking-tight text-zinc-900">Quoin</span>
 </header>
 <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">{children}</main>
 </div>
 );
}
