import { isAuthError, requireRole } from "@/lib/auth";

export async function GET(req: Request) {
  const result = await requireRole(req, ["ADMIN"]);
  if (isAuthError(result)) return result;
  return Response.json({ message: "Role check passed.", user: result });
}
