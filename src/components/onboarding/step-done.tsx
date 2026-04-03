"use client";

import Link from "next/link";

export function StepDone() {
 return (
 <div className="space-y-8 py-6 text-center">
 <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 ring-4 ring-emerald-50/70">
 <svg className="h-8 w-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
 </svg>
 </div>

 <div className="space-y-3">
 <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">You&apos;re all set</h2>
 <p className="mx-auto max-w-sm text-base leading-7 text-zinc-600">
 Your workspace is ready. Head to the dashboard to add buildings,
 review your Portfolio Manager connection, and continue setup.
 </p>
 </div>

 <div className="space-y-4 pt-4">
 <Link
 href="/dashboard"
 className="block w-full rounded-xl bg-zinc-900 px-4 py-3 text-center text-base font-semibold text-white transition-all hover:bg-zinc-800 active:scale-[0.98]"
 >
 Go to dashboard
 </Link>
 <Link
 href="/dashboard"
 className="block text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-800"
 >
 You can add buildings and finish setup later from the dashboard
 </Link>
 </div>
 </div>
 );
}
