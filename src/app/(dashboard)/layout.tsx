import React from "react";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { listMembershipSummariesForAuthUser, resolveRequestAuth } from "@/server/lib/auth";

export default async function DashboardLayout({
 children,
}: {
 children: React.ReactNode;
}) {
 const auth = await resolveRequestAuth();
 if (!auth.authUserId) redirect("/sign-in");

 const memberships = await listMembershipSummariesForAuthUser({
  authUserId: auth.authUserId,
 });

 if (memberships.length === 0) redirect("/onboarding");
 if (memberships.length > 1 && !auth.activeOrganizationId) redirect("/onboarding");

 return (
 <div className="quoin-shell min-h-screen">
 <Sidebar />
 <div className="lg:pl-[220px]">
 <Topbar />
 <main className="mx-auto max-w-[88rem] px-5 py-8 sm:px-8 sm:py-10 lg:px-12 lg:py-12 animate-in fade-in duration-500">
 {children}
 </main>
 </div>
 </div>
 );
}
