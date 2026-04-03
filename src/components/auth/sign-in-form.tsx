"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Renders the Supabase email/password sign-in form for Quoin.
 */
export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        throw signInError;
      }

      router.push("/buildings");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="email" className="block text-sm font-medium text-zinc-700">
          Work email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          placeholder="name@company.com"
          className="block w-full rounded-xl border border-zinc-200 bg-zinc-50/80 px-4 py-3.5 text-sm text-zinc-900 outline-none transition focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-500/10"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="block text-sm font-medium text-zinc-700">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          placeholder="Enter your password"
          className="block w-full rounded-xl border border-zinc-200 bg-zinc-50/80 px-4 py-3.5 text-sm text-zinc-900 outline-none transition focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-500/10"
        />
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-[linear-gradient(135deg,_#0f172a,_#134e4a)] px-4 py-3.5 text-sm font-semibold text-white shadow-[0_18px_35px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_40px_rgba(15,23,42,0.2)] disabled:translate-y-0 disabled:opacity-60"
      >
        {loading ? "Signing in..." : "Sign in"}
      </button>

      <div className="flex flex-col gap-3 border-t border-zinc-200 pt-4 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-sm leading-6">
          Need a new workspace? Create your access profile and continue into onboarding.
        </p>
        <Link href="/sign-up" className="font-semibold text-zinc-900 hover:text-zinc-700">
          Create an account
        </Link>
      </div>
    </form>
  );
}
