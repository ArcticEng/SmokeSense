import { NextResponse } from "next/server";
import { getServerUser, isSuperadmin } from "@/lib/auth";

// GET /api/admin/me — used by the UI to decide whether to show the admin link.
export async function GET() {
  const user = await getServerUser();
  return NextResponse.json({
    is_superadmin: isSuperadmin(user?.email),
    email: user?.email ?? null,
  });
}
