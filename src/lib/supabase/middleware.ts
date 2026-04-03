import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAuthConfig } from "@/server/lib/config";

/**
 * Refreshes Supabase SSR auth cookies for the current request.
 */
export async function refreshSupabaseSession(request: NextRequest) {
  const config = getSupabaseAuthConfig();
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          request.cookies.set(cookie.name, cookie.value);
        }

        response = NextResponse.next({
          request,
        });

        for (const cookie of cookiesToSet) {
          response.cookies.set(cookie.name, cookie.value, cookie.options);
        }
      },
    },
  });

  await supabase.auth.getClaims();

  return response;
}
