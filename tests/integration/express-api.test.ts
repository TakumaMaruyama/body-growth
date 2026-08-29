import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import app from "../../apps/api/src/app";
import { pool } from "../../apps/api/src/body-growth-lib/db";

describe("Express API boundaries", () => {
  it("serves the shared health contract", async () => {
    const response = await request(app).get("/api/healthz");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("issues CSRF state and rejects an untrusted mutation", async () => {
    const csrf = await request(app).get("/api/csrf");
    expect(csrf.status).toBe(200);
    expect(csrf.body.csrfToken).toEqual(expect.any(String));
    expect(String(csrf.headers["set-cookie"])).toContain("bg_csrf=");

    const rejected = await request(app)
      .post("/api/login")
      .set("origin", "https://evil.test")
      .set("host", "example.test")
      .send({ username: "someone", password: "not-a-real-password" });
    expect(rejected.status).toBe(403);
  });

  it("does not expose obsolete reset or measurement-restore routes", async () => {
    const agent = request.agent(app);
    const csrf = await agent.get("/api/csrf").set("host", "example.test");
    const token = csrf.body.csrfToken as string;
    for (const path of [
      "/api/reset/request",
      `/api/measurements/${randomUUID()}/restore`,
    ]) {
      const response = await agent
        .post(path)
        .set("host", "example.test")
        .set("origin", "http://example.test")
        .set("x-csrf-token", token)
        .send({});
      expect(response.status).toBe(404);
    }
  });
});

afterAll(async () => {
  await pool.end();
});