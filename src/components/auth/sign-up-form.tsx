"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getSignUpValidationError } from "@/components/auth/sign-up-validation";

/**
 * Renders the Supabase sign-up form used for new Quoin users.
 */
export function SignUpForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const validationError = getSignUpValidationError({
      name,
      email,
      password,
      confirmPassword,
      acceptedTerms,
    });

    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
            name,
          },
        },
      });

      if (signUpError) {
        throw signUpError;
      }

      if (data.session) {
        router.push("/onboarding");
        router.refresh();
        return;
      }

      setMessage(
        "Check your email to confirm the account, then sign in to continue.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-up failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <label htmlFor="name" className="block text-sm font-medium text-zinc-700">
            Full name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            placeholder="Enter your name"
            className="block w-full rounded-xl border border-zinc-200 bg-zinc-50/80 px-4 py-3.5 text-sm text-zinc-900 outline-none transition focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-500/10"
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
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
            minLength={8}
            placeholder="Use 8 or more characters"
            className="block w-full rounded-xl border border-zinc-200 bg-zinc-50/80 px-4 py-3.5 text-sm text-zinc-900 outline-none transition focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-500/10"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="confirm-password" className="block text-sm font-medium text-zinc-700">
            Re-enter password
          </label>
          <input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            minLength={8}
            placeholder="Re-enter your password"
            className="block w-full rounded-xl border border-zinc-200 bg-zinc-50/80 px-4 py-3.5 text-sm text-zinc-900 outline-none transition focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-500/10"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(event) => setAcceptedTerms(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border-zinc-300 text-teal-700 focus:ring-teal-600"
          />
          <span className="text-sm leading-6 text-zinc-600">
            I agree to the{" "}
            <span className="font-semibold text-zinc-900">Terms and Conditions</span>{" "}
            and understand the full legal copy will be linked here in a later pass.
          </span>
        </label>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-[linear-gradient(135deg,_#0f172a,_#134e4a)] px-4 py-3.5 text-sm font-semibold text-white shadow-[0_18px_35px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_40px_rgba(15,23,42,0.2)] disabled:translate-y-0 disabled:opacity-60"
      >
        {loading ? "Getting started..." : "Get started"}
      </button>

      <div className="flex flex-col gap-3 border-t border-zinc-200 pt-4 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-sm leading-6">
          Quoin uses secure workspace access tied to your benchmarking operations.
        </p>
        <Link href="/sign-in" className="font-semibold text-zinc-900 hover:text-zinc-700">
          Sign in
        </Link>
      </div>
    </form>
  );
}
