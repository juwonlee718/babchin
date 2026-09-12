import { ensureSchema, getDb } from "@/lib/db";
import { getCurrentUser, hashToken, makeId, makeToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const error = (message: string, status: number) => Response.json({ error: message }, { status });
const readBody = async (request: Request) => {
  try { return await request.json() as Record<string, unknown>; } catch { return null; }
};

async function dispatch(request: Request, parts: string[]) {
  await ensureSchema();
  const sql = getDb();
  const route = parts.join("/");

  if (request.method === "POST" && route === "session") {
    const body = await readBody(request);
    const displayName = String(body?.displayName ?? "").trim();
    if (!displayName || displayName.length > 20) return error("이름은 1~20자로 입력해 주세요.", 400);
    const suppliedToken = String(body?.token ?? "");
    if (suppliedToken) {
      const existing = await sql`SELECT id, invite_code AS "inviteCode" FROM users WHERE token_hash = ${hashToken(suppliedToken)} LIMIT 1`;
      if (existing[0]) {
        await sql`UPDATE users SET display_name = ${displayName} WHERE id = ${existing[0].id}`;
        return Response.json({ user: { id: existing[0].id, displayName, inviteCode: existing[0].inviteCode }, token: suppliedToken });
      }
    }
    const userId = makeId();
    const token = makeToken();
    const inviteCode = makeToken(6);
    await sql`INSERT INTO users (id, display_name, token_hash, invite_code)
      VALUES (${userId}, ${displayName}, ${hashToken(token)}, ${inviteCode})`;
    return Response.json({ user: { id: userId, displayName, inviteCode }, token }, { status: 201 });
  }

  const user = await getCurrentUser(request);
  if (!user) return error("로그인이 필요합니다.", 401);

  if (request.method === "GET" && route === "me") {
    const [friends, schedules] = await Promise.all([
      sql`SELECT u.id, u.display_name AS "displayName", u.latitude, u.longitude,
        u.sharing, u.last_seen AS "lastSeen"
        FROM friendships f JOIN users u ON u.id = f.friend_id
        WHERE f.user_id = ${user.id} ORDER BY u.display_name`,
      sql`SELECT id, course_name AS "courseName", starts_at AS "startsAt", room
        FROM schedules WHERE user_id = ${user.id} ORDER BY starts_at`,
    ]);
    return Response.json({ user, friends, schedules });
  }

  if (request.method === "POST" && route === "invites/accept") {
    const body = await readBody(request);
    const code = String(body?.code ?? "").trim();
    const rows = await sql`SELECT id, display_name AS "displayName" FROM users WHERE invite_code = ${code} LIMIT 1`;
    const inviter = rows[0];
    if (!inviter) return error("유효하지 않은 초대 링크입니다.", 404);
    if (inviter.id === user.id) return error("내 초대 링크는 사용할 수 없어요.", 400);
    await sql`INSERT INTO friendships (user_id, friend_id) VALUES (${user.id}, ${inviter.id}) ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO friendships (user_id, friend_id) VALUES (${inviter.id}, ${user.id}) ON CONFLICT DO NOTHING`;
    return Response.json({ friend: inviter });
  }

  if (request.method === "POST" && route === "location") {
    const body = await readBody(request);
    const sharing = Boolean(body?.sharing);
    if (!sharing) {
      await sql`UPDATE users SET latitude = NULL, longitude = NULL, sharing = FALSE, last_seen = NOW() WHERE id = ${user.id}`;
      return Response.json({ ok: true, sharing: false });
    }
    const latitude = Number(body?.latitude);
    const longitude = Number(body?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return error("위치 정보가 올바르지 않습니다.", 400);
    const inCampus = latitude >= 37.441 && latitude <= 37.472 && longitude >= 126.935 && longitude <= 126.965;
    if (!inCampus) return Response.json({ error: "캠퍼스 밖에서는 위치를 공유할 수 없어요.", code: "OUTSIDE_CAMPUS" }, { status: 403 });
    await sql`UPDATE users SET latitude = ${latitude}, longitude = ${longitude}, sharing = TRUE, last_seen = NOW() WHERE id = ${user.id}`;
    return Response.json({ ok: true, sharing: true, latitude, longitude });
  }

  if (request.method === "POST" && route === "schedules") {
    const body = await readBody(request);
    const courseName = String(body?.courseName ?? "").trim();
    const startsAt = String(body?.startsAt ?? "").trim();
    const room = String(body?.room ?? "").trim();
    if (!courseName || !startsAt || !room || courseName.length > 40 || startsAt.length > 10 || room.length > 40) return error("과목명, 시간, 장소를 확인해 주세요.", 400);
    const scheduleId = makeId();
    await sql`INSERT INTO schedules (id, user_id, course_name, starts_at, room)
      VALUES (${scheduleId}, ${user.id}, ${courseName}, ${startsAt}, ${room})`;
    return Response.json({ schedule: { id: scheduleId, courseName, startsAt, room } }, { status: 201 });
  }

  return error("찾을 수 없는 API입니다.", 404);
}

type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, context: Context) {
  try { return await dispatch(request, (await context.params).path); }
  catch (cause) { console.error(cause); return error("서버 처리 중 문제가 생겼습니다.", 500); }
}
export async function POST(request: Request, context: Context) {
  try { return await dispatch(request, (await context.params).path); }
  catch (cause) { console.error(cause); return error("서버 처리 중 문제가 생겼습니다.", 500); }
}
