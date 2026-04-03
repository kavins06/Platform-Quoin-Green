import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAuthConfig } from "@/server/lib/config";

function buildErrorRedirect(request: NextRequest, message: string) {
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/sign-in";
  redirectUrl.search = "";
  redirectUrl.searchParams.set("error", message);
  return NextResponse.redirect(redirectUrl);
}

/**
 * Handles Supabase email confirmation and auth callback redirects.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return buildErrorRedirect(request, "Missing confirmation code.");
  }

  const config = getSupabaseAuthConfig();
  let response = NextResponse.redirect(new URL("/onboarding", request.url));

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          response.cookies.set(cookie.name, cookie.value, cookie.options);
        }
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return buildErrorRedirect(request, error.message);
  }

  return response;
}
