import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isKnownAppPath, isKnownPublicPath } from "../client/src/lib/known-routes.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("SEO / public web assets", () => {
  it("ships robots.txt, sitemap.xml, and favicon in client/public", () => {
    assert.ok(existsSync(join(root, "client/public/robots.txt")));
    assert.ok(existsSync(join(root, "client/public/sitemap.xml")));
    assert.ok(existsSync(join(root, "client/public/favicon.svg")));
    const robots = readFileSync(join(root, "client/public/robots.txt"), "utf8");
    assert.match(robots, /Sitemap:\s*https:\/\/leviosa\.zeluai\.ca\/sitemap\.xml/);
    const sitemap = readFileSync(join(root, "client/public/sitemap.xml"), "utf8");
    assert.match(sitemap, /\/home/);
    assert.match(sitemap, /\/privacy/);
    assert.match(sitemap, /\/terms/);
  });

  it("index.html has description, OG, and canonical tags", () => {
    const html = readFileSync(join(root, "client/index.html"), "utf8");
    assert.match(html, /meta\s+name="description"/);
    assert.match(html, /property="og:title"/);
    assert.match(html, /property="og:description"/);
    assert.match(html, /rel="canonical"/);
    assert.match(html, /rel="icon"/);
  });

  it("custom 404 page exists and is wired", () => {
    assert.ok(existsSync(join(root, "client/src/pages/NotFoundPage.jsx")));
    const app = readFileSync(join(root, "client/src/App.jsx"), "utf8");
    assert.match(app, /NotFoundPage/);
    assert.match(app, /isKnownAppPath|isKnownPublicPath/);
  });

  it("known-route helpers classify public vs unknown", () => {
    assert.equal(isKnownPublicPath("/home"), true);
    assert.equal(isKnownPublicPath("/admin-login"), true);
    assert.equal(isKnownPublicPath("/this-is-missing"), false);
    assert.equal(isKnownAppPath("/leads"), true);
    assert.equal(isKnownAppPath("/leads/123"), true);
    assert.equal(isKnownAppPath("/nope"), false);
  });
});
