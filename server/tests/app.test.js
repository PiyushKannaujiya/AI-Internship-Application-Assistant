import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { env } from "../src/config/env.js";

test("GET /api/health returns HTTP 200", async () => {
  const response = await request(app).get("/api/health");

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(
    response.body.message,
    "AI Internship Application Assistant API is running"
  );
  assert.equal(response.body.status, "ok");
  assert.ok(!Number.isNaN(Date.parse(response.body.timestamp)));
});

test("GET /api/health/ready reports database readiness", async () => {
  const response = await request(app).get("/api/health/ready");

  assert.equal(response.status, 503);
  assert.equal(response.body.success, false);
  assert.equal(response.body.status, "not_ready");
});

test("Unknown route returns HTTP 404 with a consistent error shape", async () => {
  const response = await request(app).get("/api/unknown");

  assert.equal(response.status, 404);
  assert.equal(response.body.success, false);
  assert.equal(response.body.code, "NOT_FOUND");
});

test("POST to health endpoint returns HTTP 404", async () => {
  const response = await request(app)
    .post("/api/health")
    .send({ test: true });

  assert.equal(response.status, 404);
  assert.equal(response.body.success, false);
});

test("Health response includes security headers", async () => {
  const response = await request(app).get("/api/health");

  assert.equal(response.status, 200);
  assert.ok(response.headers["x-content-type-options"]);
  assert.ok(response.headers["content-security-policy"]);
  assert.equal(response.headers["x-powered-by"], undefined);
});

test("Health response includes the configured CORS origin", async () => {
  const origin = env.CORS_ORIGINS[0];
  const response = await request(app).get("/api/health").set("Origin", origin);

  assert.equal(response.status, 200);
  assert.equal(response.headers["access-control-allow-origin"], origin);
});

test("Disallowed cross-origin requests are rejected", async () => {
  const response = await request(app)
    .get("/api/health")
    .set("Origin", "https://not-allowed.example");

  assert.equal(response.status, 403);
  assert.equal(response.body.success, false);
});

test("OpenAPI document is served", async () => {
  const response = await request(app).get("/api/openapi.json");

  assert.equal(response.status, 200);
  assert.equal(response.body.openapi, "3.0.3");
  assert.ok(response.body.paths["/auth/login"]);
});
