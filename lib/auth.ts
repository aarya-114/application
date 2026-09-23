import { createHmac, timingSafeEqual } from "node:crypto";
import type { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE = "quarantine_session";
const SESSION_LIFETIME_SECONDS = 60 * 60 * 8;

type SessionPayload = { userId: string; expiresAt: number };
export type SessionUser = { id: string; name: string; role: UserRole };

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET must be set to sign sessions.");
  return secret;
}

function sign(payload: string) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function createSessionToken(userId: string) {
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      expiresAt: Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS,
    } satisfies SessionPayload),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token: string): SessionPayload | null {
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra !== undefined) return null;

  const expected = Buffer.from(sign(payload));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
    if (
      typeof decoded.userId !== "string" ||
      typeof decoded.expiresAt !== "number" ||
      decoded.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export async function getSessionUserFromToken(
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload) return null;
  return prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, name: true, role: true },
  });
}

function getCookie(req: Request, name: string) {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return undefined;
  const item = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return item?.slice(name.length + 1);
}

export async function requireRole(
  req: Request,
  roles: UserRole[],
): Promise<SessionUser | NextResponse> {
  const user = await getSessionUserFromToken(getCookie(req, SESSION_COOKIE));
  if (!user) {
    return NextResponse.json({ error: "Authentication required. Please sign in." }, { status: 401 });
  }
  if (!roles.includes(user.role)) {
    return NextResponse.json(
      { error: `Forbidden: this action requires one of these roles: ${roles.join(", ")}.` },
      { status: 403 },
    );
  }
  return user;
}

export function isAuthError(result: SessionUser | NextResponse): result is NextResponse {
  return result instanceof NextResponse;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_LIFETIME_SECONDS,
  };
}
