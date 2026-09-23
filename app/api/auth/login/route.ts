import { NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  let body: { userId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }

  if (typeof body.userId !== "string") {
    return NextResponse.json({ error: "Choose a demo identity to sign in." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: body.userId },
    select: { id: true, name: true, role: true },
  });
  if (!user || !["demo-nurse", "demo-doctor", "demo-admin"].includes(user.id)) {
    return NextResponse.json({ error: "That identity is not one of the seeded demo users." }, { status: 400 });
  }

  const response = NextResponse.json({ user });
  response.cookies.set(SESSION_COOKIE, createSessionToken(user.id), sessionCookieOptions());
  return response;
}
