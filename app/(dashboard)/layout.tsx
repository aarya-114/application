import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUserFromToken, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUserFromToken(cookies().get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");
  return children;
}
