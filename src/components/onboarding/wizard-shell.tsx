"use client";

import { motion, AnimatePresence } from "framer-motion";

const STEP_LABELS = ["Organization", "ESPM", "Done"];

interface WizardShellProps {
 currentStep: number;
 children: React.ReactNode;
}

export function WizardShell({ currentStep, children }: WizardShellProps) {
 return (
 <div className="rounded-[28px] border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(24,24,27,0.03),0_16px_48px_rgba(24,24,27,0.06)]">
 {/* Progress bar */}
 <div className="border-b border-zinc-200/80 px-5 py-8 sm:px-8">
 <div className="flex items-center justify-between px-1 sm:px-0">
 {STEP_LABELS.map((label, i) => {
 const step = i + 1;
 const isCompleted = step < currentStep;
 const isCurrent = step === currentStep;

 return (
 <div key={label} className="flex flex-1 items-center last:flex-none">
 <div className="flex flex-col items-center">
 <motion.div
 initial={false}
 animate={isCurrent ? { scale: 1.1 } : { scale: 1 }}
 className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-all duration-300 ${
 isCompleted
 ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
 : isCurrent
 ? "bg-zinc-900 text-white ring-4 ring-zinc-900/8"
 : "border border-zinc-200 bg-zinc-50 text-zinc-400"
 }`}
 >
 {isCompleted ? (
 <motion.svg 
 initial={{ scale: 0, opacity: 0 }}
 animate={{ scale: 1, opacity: 1 }}
 className="w-4 h-4" 
 fill="none" 
 viewBox="0 0 24 24" 
 stroke="currentColor"
 >
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
 </motion.svg>
 ) : step}
 </motion.div>
 <span
 className={`mt-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors duration-300 ${
 isCurrent ? "text-zinc-900" : isCompleted ? "text-emerald-700" : "text-zinc-400"
 }`}
 >
 {label}
 </span>
 </div>
 {i < STEP_LABELS.length - 1 && (
 <div className="mb-6 mx-2 flex flex-1 items-center sm:mx-4">
 <div
 className={`h-px w-full transition-colors duration-500 ${
 step < currentStep ? "bg-emerald-200" : "bg-zinc-200"
 }`}
 />
 </div>
 )}
 </div>
 );
 })}
 </div>
 </div>

 {/* Step content */}
 <div className="relative overflow-hidden px-5 py-8 sm:px-8 sm:py-10">
 <AnimatePresence mode="wait">
 <motion.div
 key={currentStep}
 initial={{ opacity: 0, x: 20 }}
 animate={{ opacity: 1, x: 0 }}
 exit={{ opacity: 0, x: -20 }}
 transition={{ duration: 0.3, ease: "easeInOut" }}
 className="min-h-[360px]"
 >
 {children}
 </motion.div>
 </AnimatePresence>
 </div>
 </div>
 );
}
