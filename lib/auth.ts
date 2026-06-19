import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// Reads the current authenticated user from the request cookies.
export async function getServerUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {
          /* read-only in route handlers */
        },
      },
    }
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

// Superadmin is gated by a server-side env allowlist of emails.
// Set SUPERADMIN_EMAILS="you@arcticengineering.co.za,other@..." (never NEXT_PUBLIC_).
export function isSuperadmin(email?: string | null): boolean {
  if (!email) return false;
  const list = (process.env.SUPERADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export async function requireSuperadmin() {
  const user = await getServerUser();
  if (!user || !isSuperadmin(user.email)) return null;
  return user;
}
