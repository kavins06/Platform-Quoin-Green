import { redirect } from "next/navigation";
import Link from "next/link";
import { Zap, Download, CheckCircle2, FileText } from "lucide-react";
import { resolveRequestAuth } from "@/server/lib/auth";

export default async function HomePage() {
 const auth = await resolveRequestAuth();
 if (auth.authUserId) redirect("/buildings");

 return (
 <div className="flex min-h-screen flex-col bg-zinc-50 selection:bg-zinc-200 overflow-hidden relative">
 {/* Background Glow */}
 <div className="absolute top-0 inset-x-0 h-[500px] flex justify-center overflow-hidden pointer-events-none">
 <div className="w-[1000px] h-[500px] bg-gradient-to-b from-zinc-200/50 to-transparent opacity-50 rounded-full -tranzinc-y-1/2" />
 </div>

 {/* Header */}
 <header className="flex h-16 w-full items-center justify-between border-b border-zinc-200/80 bg-white px-6 sticky top-0 z-50 transition-all">
 <span className="flex items-center gap-2 text-lg font-bold tracking-tight text-zinc-900">
 <Zap size={20} className="fill-zinc-900" />
 Quoin
 </span>
 <div className="flex items-center gap-5">
 <Link
 href="/sign-in"
 className="text-sm font-semibold text-zinc-600 transition-colors hover:text-zinc-900"
 >
 Sign in
 </Link>
 <Link
 href="/sign-up"
 className="bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-zinc-800 hover: hover:-tranzinc-y-0.5 active:tranzinc-y-0"
 >
 Get started
 </Link>
 </div>
 </header>

 {/* Hero */}
 <main className="flex flex-1 flex-col items-center justify-center px-4 text-center py-24 sm:py-32 z-10">
 <div className="animate-in fade-in slide-in-from-bottom-8 duration-1000 ease-out fill-mode-both max-w-4xl mx-auto">
 <div className="mb-8 inline-flex items-center rounded-full border border-zinc-200 bg-white px-3 py-1 text-sm font-medium text-zinc-600">
 <span className="flex h-2 w-2 rounded-full bg-emerald-500 mr-2 animate-pulse"></span>
 Benchmark workflow ready
 </div>
 <h1 className="text-4xl font-extrabold tracking-tight text-zinc-900 sm:text-4xl leading-[1.1]">
 ENERGY STAR benchmarking, <br className="hidden sm:block" />
 <span className="text-zinc-500">governed</span>.
 </h1>
 <p className="mx-auto mt-8 max-w-2xl text-base text-zinc-500 leading-relaxed font-medium">
 Quoin connects to Portfolio Manager, governs local utility data, evaluates
 annual benchmarking readiness, and packages evidence-backed submission work
 so operators can execute benchmarking without spreadsheet drift.
 </p>
 <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-4">
 <Link
 href="/sign-up"
 className="w-full sm:w-auto bg-zinc-900 px-8 py-4 text-base font-semibold text-white transition-all hover:bg-zinc-800 hover: hover:-tranzinc-y-1 active:scale-[0.98] active:tranzinc-y-0 flex items-center justify-center gap-2"
 >
 Get started
 <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
 </svg>
 </Link>
 <Link
 href="/sign-in"
 className="w-full sm:w-auto border border-zinc-200 px-8 py-4 text-base font-semibold text-zinc-900 transition-all hover:bg-white hover:border-zinc-300 hover: active:scale-[0.98]"
 >
 Sign in
 </Link>
 </div>
 </div>

 {/* Value props */}
 <div className="mt-32 grid max-w-6xl grid-cols-1 gap-6 sm:grid-cols-3 mx-auto z-10">
 <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 delay-300 ease-out fill-mode-both border border-zinc-200 p-8 text-left transition-all hover: hover:-tranzinc-y-1 group">
 <div className="h-12 w-12 bg-zinc-100 flex items-center justify-center mb-6 border border-zinc-200/80 group-hover:scale-105 transition-transform">
 <Download size={22} className="text-zinc-600" />
 </div>
 <h3 className="text-xl font-bold tracking-tight text-zinc-900">Connect</h3>
 <p className="mt-3 text-base text-zinc-500 leading-relaxed font-medium">
 Connect Portfolio Manager, import properties, and bring in utility data from
 PM, Green Button, CSV, or manual correction paths.
 </p>
 </div>
 <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 delay-500 ease-out fill-mode-both border border-zinc-200 p-8 text-left transition-all hover: hover:-tranzinc-y-1 group">
 <div className="h-12 w-12 bg-emerald-50 flex items-center justify-center mb-6 border border-emerald-100 group-hover:scale-105 transition-transform">
 <CheckCircle2 size={22} className="text-emerald-600" />
 </div>
 <h3 className="text-xl font-bold tracking-tight text-zinc-900">Govern</h3>
 <p className="mt-3 text-base text-zinc-500 leading-relaxed font-medium">
 Normalize local energy history, reconcile canonical source state, and review
 PM setup, meter linking, and usage readiness before any push back to ESPM.
 </p>
 </div>
 <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 delay-700 ease-out fill-mode-both border border-zinc-200 p-8 text-left transition-all hover: hover:-tranzinc-y-1 group">
 <div className="h-12 w-12 bg-zinc-100 flex items-center justify-center mb-6 border border-zinc-200/80 group-hover:scale-105 transition-transform">
 <FileText size={22} className="text-zinc-600" />
 </div>
 <h3 className="text-xl font-bold tracking-tight text-zinc-900">Submit</h3>
 <p className="mt-3 text-base text-zinc-500 leading-relaxed font-medium">
 Generate benchmark verification packets, checklist evidence, and submission
 records that stay traceable to the governed local record.
 </p>
 </div>
 </div>
 </main>

 {/* Footer */}
 <footer className="border-t border-zinc-200/80 bg-white px-6 py-10 z-10">
 <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between">
 <span className="flex items-center gap-2 text-base font-bold tracking-tight text-zinc-900">
 <Zap size={16} className="fill-zinc-900" />
 Quoin
 </span>
 <p className="mt-4 md:mt-0 text-sm font-medium text-zinc-500">
 &copy; {new Date().getFullYear()} Quoin. All rights reserved. &middot; Washington, DC
 </p>
 </div>
 </footer>
 </div>
 );
}
