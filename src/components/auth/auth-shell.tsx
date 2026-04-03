import type { ReactNode } from "react";

interface AuthShellProps {
  eyebrow: string;
  title: string;
  description: string;
  footer: string;
  children: ReactNode;
}

/**
 * Renders the shared polished auth layout for Quoin entry flows.
 */
export function AuthShell(props: AuthShellProps) {
  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(20,184,166,0.14),_transparent_38%),linear-gradient(180deg,_#f8fbfd_0%,_#eef4f7_100%)] px-4 py-10 text-zinc-900 selection:bg-emerald-100 md:px-8 md:py-14">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-2xl items-center justify-center">
        <section className="w-full rounded-[2rem] border border-white/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur md:p-8">
          <div className="mb-8 space-y-4 border-b border-zinc-200/80 pb-6">
            <div className="inline-flex w-fit items-center rounded-full border border-teal-100 bg-teal-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-700">
              {props.eyebrow}
            </div>
            <div className="space-y-3">
              <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-zinc-950 sm:text-[2.85rem]">
                {props.title}
              </h1>
              <p className="max-w-xl text-base leading-7 text-zinc-600">
                {props.description}
              </p>
            </div>
            {props.footer ? (
              <p className="max-w-xl text-sm leading-6 text-zinc-500">{props.footer}</p>
            ) : null}
          </div>
          {props.children}
        </section>
      </div>
    </div>
  );
}
