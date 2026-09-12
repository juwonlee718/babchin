import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker from "../dist/server/index.js";

const sqlite = new DatabaseSync(":memory:");
const DB = {
  prepare(sql) {
    const statement = sqlite.prepare(sql);
    const query = {
      args: [],
      bind(...args) { this.args = args; return this; },
      first() { return statement.get(...this.args) ?? null; },
      all() { return { results: statement.all(...this.args) }; },
      run() { return statement.run(...this.args); },
    };
    return query;
  },
  async batch(queries) { return queries.map((query) => query.run()); },
};

const env = { DB, ASSETS: { fetch: () => new Response("asset") } };
const call = (path, method = "GET", data, token) => worker.fetch(new Request(`https://test.local${path}`, {
  method,
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { "content-type": "application/json" } : {}) },
  body: data ? JSON.stringify(data) : undefined,
}), env);

const create = async (displayName) => {
  const response = await call("/api/session", "POST", { displayName });
  assert.equal(response.status, 201);
  return response.json();
};

const minji = await create("민지");
const jihoon = await create("지훈");
let response = await call("/api/invites/accept", "POST", { code: minji.user.inviteCode }, jihoon.token);
assert.equal(response.status, 200);
response = await call("/api/location", "POST", { sharing: true, latitude: 37.4564, longitude: 126.9515 }, minji.token);
assert.equal(response.status, 200);
response = await call("/api/location", "POST", { sharing: true, latitude: 37.5, longitude: 127 }, minji.token);
assert.equal(response.status, 403);
response = await call("/api/schedules", "POST", { courseName: "회로이론", startsAt: "13:00", room: "302동" }, minji.token);
assert.equal(response.status, 201);
response = await call("/api/me", "GET", null, jihoon.token);
const me = await response.json();
assert.equal(me.friends[0].displayName, "민지");
response = await call("/api/me", "GET", null, minji.token);
const owner = await response.json();
assert.equal(owner.schedules[0].courseName, "회로이론");
console.log("Backend smoke test passed");
