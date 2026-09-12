const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const id = (bytes = 12) => {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(data, (v) => v.toString(16).padStart(2, "0")).join("");
};

const hash = async (value) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
};

async function ensureSchema(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, invite_code TEXT NOT NULL UNIQUE, latitude REAL, longitude REAL, sharing INTEGER NOT NULL DEFAULT 1, last_seen TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS friendships (user_id TEXT NOT NULL, friend_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, friend_id))").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS friendships_friend_idx ON friendships(friend_id)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, course_name TEXT NOT NULL, starts_at TEXT NOT NULL, room TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS schedules_user_idx ON schedules(user_id)").run();
}

async function body(request) {
  try { return await request.json(); } catch { return null; }
}

async function currentUser(request, db) {
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const tokenHash = await hash(auth.slice(7));
  return db.prepare("SELECT id, display_name, invite_code, latitude, longitude, sharing, last_seen FROM users WHERE token_hash = ?").bind(tokenHash).first();
}

async function api(request, env, url) {
  await ensureSchema(env.DB);

  if (request.method === "POST" && url.pathname === "/api/session") {
    const input = await body(request);
    const displayName = String(input?.displayName || "").trim();
    if (!displayName || displayName.length > 20) return json({ error: "이름은 1~20자로 입력해 주세요." }, 400);

    if (input?.token) {
      const tokenHash = await hash(String(input.token));
      const existing = await env.DB.prepare("SELECT id, invite_code FROM users WHERE token_hash = ?").bind(tokenHash).first();
      if (existing) {
        await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(displayName, existing.id).run();
        return json({ user: { id: existing.id, displayName, inviteCode: existing.invite_code }, token: input.token });
      }
    }

    const userId = id(12);
    const token = id(24);
    const inviteCode = id(6);
    await env.DB.prepare("INSERT INTO users (id, display_name, token_hash, invite_code) VALUES (?, ?, ?, ?)")
      .bind(userId, displayName, await hash(token), inviteCode).run();
    return json({ user: { id: userId, displayName, inviteCode }, token }, 201);
  }

  const user = await currentUser(request, env.DB);
  if (!user) return json({ error: "로그인이 필요합니다." }, 401);

  if (request.method === "GET" && url.pathname === "/api/me") {
    const friends = await env.DB.prepare(`SELECT u.id, u.display_name AS displayName, u.latitude, u.longitude, u.sharing, u.last_seen AS lastSeen
      FROM friendships f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? ORDER BY u.display_name`).bind(user.id).all();
    const schedules = await env.DB.prepare("SELECT id, course_name AS courseName, starts_at AS startsAt, room FROM schedules WHERE user_id = ? ORDER BY starts_at").bind(user.id).all();
    return json({
      user: { id: user.id, displayName: user.display_name, inviteCode: user.invite_code, latitude: user.latitude, longitude: user.longitude, sharing: Boolean(user.sharing), lastSeen: user.last_seen },
      friends: (friends.results || []).map((friend) => ({ ...friend, sharing: Boolean(friend.sharing) })),
      schedules: schedules.results || [],
    });
  }

  if (request.method === "POST" && url.pathname === "/api/schedules") {
    const input = await body(request);
    const courseName = String(input?.courseName || "").trim();
    const startsAt = String(input?.startsAt || "").trim();
    const room = String(input?.room || "").trim();
    if (!courseName || !startsAt || !room || courseName.length > 40 || startsAt.length > 10 || room.length > 40) {
      return json({ error: "과목명, 시간, 장소를 확인해 주세요." }, 400);
    }
    const scheduleId = id(10);
    await env.DB.prepare("INSERT INTO schedules (id, user_id, course_name, starts_at, room) VALUES (?, ?, ?, ?, ?)")
      .bind(scheduleId, user.id, courseName, startsAt, room).run();
    return json({ schedule: { id: scheduleId, courseName, startsAt, room } }, 201);
  }

  if (request.method === "POST" && url.pathname === "/api/invites/accept") {
    const input = await body(request);
    const code = String(input?.code || "").trim();
    const inviter = await env.DB.prepare("SELECT id, display_name FROM users WHERE invite_code = ?").bind(code).first();
    if (!inviter) return json({ error: "유효하지 않은 초대 링크입니다." }, 404);
    if (inviter.id === user.id) return json({ error: "내 초대 링크는 사용할 수 없어요." }, 400);
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)").bind(user.id, inviter.id),
      env.DB.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)").bind(inviter.id, user.id),
    ]);
    return json({ friend: { id: inviter.id, displayName: inviter.display_name } });
  }

  if (request.method === "POST" && url.pathname === "/api/location") {
    const input = await body(request);
    const sharing = Boolean(input?.sharing);
    let latitude = null;
    let longitude = null;
    if (sharing) {
      latitude = Number(input?.latitude);
      longitude = Number(input?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return json({ error: "위치 정보가 올바르지 않습니다." }, 400);
      const inCampus = latitude >= 37.441 && latitude <= 37.472 && longitude >= 126.935 && longitude <= 126.965;
      if (!inCampus) return json({ error: "캠퍼스 밖에서는 위치를 공유할 수 없어요.", code: "OUTSIDE_CAMPUS" }, 403);
    }
    await env.DB.prepare("UPDATE users SET latitude = ?, longitude = ?, sharing = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(latitude, longitude, sharing ? 1 : 0, user.id).run();
    return json({ ok: true, sharing, latitude, longitude });
  }

  return json({ error: "찾을 수 없는 API입니다." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await api(request, env, url); }
      catch (error) { console.error(error); return json({ error: "서버 처리 중 문제가 생겼습니다." }, 500); }
    }
    return env.ASSETS.fetch(request);
  },
};
