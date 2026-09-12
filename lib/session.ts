import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";

export const makeId = () => randomUUID().replaceAll("-", "");
export const makeToken = (bytes = 24) => randomBytes(bytes).toString("hex");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function getCurrentUser(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const sql = getDb();
  const rows = await sql`SELECT id, display_name AS "displayName", invite_code AS "inviteCode",
    latitude, longitude, sharing, last_seen AS "lastSeen"
    FROM users WHERE token_hash = ${hashToken(authorization.slice(7))} LIMIT 1`;
  return rows[0] ?? null;
}
