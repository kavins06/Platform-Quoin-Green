import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAuthConfig } from "@/server/lib/config";

/**
 * Creates a request-scoped Supabase server client backed by Next cookies.
 */
export async function createSupabaseServerClient() {
  const config = getSupabaseAuthConfig();
  const cookieStore = await cookies();

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const cookie of cookiesToSet) {
            cookieStore.set(cookie.name, cookie.value, cookie.options);
          }
        } catch {
          // Server Components cannot always write cookies. Middleware refreshes
          // the session cookie when needed.
        }
      },
    },
  });
}
