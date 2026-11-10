/**
 * Profile pictures: file validation, signed proxy URLs, and who may change one.
 * No network, no DB — the route's refusals happen before either is touched.
 *
 * Run: node --test tests/profilePhoto.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "profile-photo-test-secret";

const router = require("../routes/profilePhoto");
const { verifyMediaSignature } = require("../utils/mediaSecurity");
const { sniffImageType, signedUrl } = router._test;

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);

test("only real JPEG, PNG and WebP bytes are accepted", () => {
  assert.equal(sniffImageType(JPEG), "image/jpeg");
  assert.equal(sniffImageType(PNG), "image/png");
  assert.equal(sniffImageType(WEBP), "image/webp");
  assert.equal(sniffImageType(Buffer.from("<svg onload=alert(1)>....")), "");
  assert.equal(sniffImageType(Buffer.from("%PDF-1.7 ......")), "");
});

test("the stored URL is a signed proxy URL the media route accepts", () => {
  const url = signedUrl("drive", "abc123", 42);
  assert.match(url, /\/upload\/secure\/drive\/abc123\?sig=/);
  const sig = new URL(url, "http://x").searchParams.get("sig");
  assert.equal(verifyMediaSignature("drive:abc123", sig), true);
  assert.equal(verifyMediaSignature("drive:other", sig), false);
});

function call(method, token, body) {
  const app = express();
  app.use("/api/profile-photo", router);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const req = http.request(
        { port, method, path: "/api/profile-photo", headers: token ? { authorization: `Bearer ${token}` } : {} },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            server.close();
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
          });
        },
      );
      req.on("error", (e) => { server.close(); reject(e); });
      if (body) req.write(body);
      req.end();
    });
  });
}

test("signed-out callers are refused", async () => {
  assert.equal((await call("DELETE")).status, 401);
});

test("a developer inside a portal user's context cannot change that account's picture", async () => {
  const token = jwt.sign({ id: "dev1", role: "developer", portalContextUserId: "pu1" }, process.env.JWT_SECRET);
  const res = await call("DELETE", token);
  assert.equal(res.status, 403);
  assert.match(res.body.message, /account holder/);
});
