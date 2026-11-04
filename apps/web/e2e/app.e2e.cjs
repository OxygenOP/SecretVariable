/**
 * End-to-end test of the web app in a real browser against a running server.
 *   SV_E2E_URL=http://localhost:8080 node e2e/app.e2e.cjs
 * Needs Playwright with Chromium (`npx playwright install chromium`). Registers fresh users, so any database works.
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const fs = require("node:fs");
const base = process.env.SV_E2E_URL || "http://localhost:8080";
const stamp = Date.now().toString(36);
const pw = "correct horse battery";
let step = 0;
// RFC 6238 TOTP so the test can act as the authenticator app
const b32 = (str) => { const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const out = []; for (const ch of str.replace(/[\s=]/g, "")) { v = (v << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const totp = (secret, offsetSteps = 0) => { const c = Math.floor(Date.now() / 30000) + offsetSteps; const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(c)); const h = createHmac("sha1", b32(secret)).update(m).digest(); const o = h[19] & 15; return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000).padStart(6, "0"); };
const MAIL_LOG = process.env.SV_E2E_MAIL_LOG; // optional: server log that contains emailed codes (SV_SMTP_URL=console)
const ok = (m) => console.log(`ok ${++step} - ${m}`);

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page) => { page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error" && !/401|403|404|409|Failed to load resource/.test(m.text())) errors.push(m.text()); }); };

  // second user, created through the API, will be invited later
  const guestEmail = `guest-${stamp}@e2e.test`;
  const reg = await fetch(`${base}/api/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Guest Gray", email: guestEmail, password: pw }) });
  assert.equal(reg.status, 201);

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await ctx.newPage(); watch(page);

  // --- an error message never moves the layout (reserved slot)
  await page.goto(`${base}/login`);
  await page.fill("#email", "nobody@e2e.test"); await page.fill("#password", "not-a-real-password");
  const btnBefore = await page.locator("button.primary.block").boundingBox();
  const linkBefore = await page.locator(".switch-mode").boundingBox();
  await page.click("button.primary.block");
  await page.waitForSelector(".form-error:not(:empty)");
  const btnAfter = await page.locator("button.primary.block").boundingBox();
  const linkAfter = await page.locator(".switch-mode").boundingBox();
  assert.equal(btnAfter.y, btnBefore.y); assert.equal(btnAfter.height, btnBefore.height); assert.equal(linkAfter.y, linkBefore.y);
  ok("a form error appears without moving the button or links");

  // --- sign up
  await page.goto(`${base}/register`);
  await page.fill("#name", "Owen Owner");
  await page.fill("#email", `owen-${stamp}@e2e.test`);
  await page.fill("#password", pw);
  await page.click("button.primary");
  await page.waitForSelector("h1:has-text('Projects')");
  assert.ok(await page.locator("text=Get started").isVisible());
  ok("registers and lands on an empty projects screen with getting-started");

  // --- create a project
  await page.click("button:has-text('New project')");
  await page.fill("#pn", "e2e-app");
  await page.click(".modal button.primary");
  await page.waitForSelector("h1:has-text('e2e-app')");
  assert.deepEqual(await page.locator("nav[aria-label='Project'] .tab").allTextContents(), ["development", "staging", "production", "Members", "Tokens", "Audit log", "Settings"]);
  ok("creates a project with three environments");

  // --- paste a .env and save v1
  await page.click("button:has-text('Paste a .env file')");
  await page.fill("#paste", "DATABASE_URL=postgres://u:p@h/db\nAPI_KEY=abc123\n# comment\nDEBUG=true\n");
  await page.click(".modal button.primary:has-text('Use these')");
  await page.click("button:has-text('Review and save')");
  await page.fill("#msg", "initial import");
  await page.click(".modal button:has-text('Save new version')");
  await page.waitForSelector(".var-name");
  assert.deepEqual(await page.locator(".var-name").allTextContents(), ["API_KEY", "DATABASE_URL", "DEBUG"]);
  ok("pastes a .env file and saves it as v1");

  // --- values are masked until revealed
  const bodyText = await page.locator("main").innerText();
  assert.ok(!bodyText.includes("abc123") && !bodyText.includes("postgres://"));
  await page.click("button[aria-label='Reveal value of API_KEY']");
  await page.waitForSelector(".var-value.shown");
  assert.ok((await page.locator("main").innerText()).includes("abc123"));
  assert.ok(!(await page.locator("main").innerText()).includes("postgres://"));
  await page.click("button:has-text('Reveal values')");
  assert.ok((await page.locator("main").innerText()).includes("postgres://u:p@h/db"));
  ok("values stay masked until revealed (per row or all)");

  // --- edit, save v2
  await page.click("button:has-text('Edit variables')");
  await page.locator("input[aria-label='Value of API_KEY']").fill("rotated-456");
  await page.click("button:has-text('Add variable')");
  await page.locator("input.var-input").nth(-2).fill("NEW_FLAG");
  await page.locator("input.var-input").nth(-1).fill("1");
  await page.click("button:has-text('Review and save')");
  const review = await page.locator(".modal").innerText();
  assert.ok(review.includes("+ NEW_FLAG") && review.includes("~ API_KEY"));
  await page.fill("#msg", "rotate key, add flag");
  await page.click(".modal button:has-text('Save new version')");
  await page.waitForSelector("text=Saved development as v2");
  ok("edits variables, reviews the diff, saves v2");

  // --- invalid names are rejected in the editor
  await page.click("button:has-text('Edit variables')");
  await page.click("button:has-text('Add variable')");
  await page.locator("input.var-input").nth(-2).fill("bad name");
  assert.ok(await page.locator("button:has-text('Review and save')").isDisabled());
  await page.click("button:has-text('Cancel')");
  ok("blocks invalid variable names");

  // --- history, compare, rollback
  await page.click("role=tab[name='History']");
  await page.waitForSelector("table[aria-label='Version history']");
  const rows = await page.locator("table[aria-label='Version history'] tbody tr").count();
  assert.equal(rows, 2);
  await page.locator("tbody tr").first().hover();
  await page.locator("button:has-text('Compare')").first().click();
  await page.waitForSelector(".modal table[aria-label='Differences']");
  const diffText = await page.locator(".modal").innerText();
  assert.ok(diffText.includes("API_KEY") && diffText.includes("NEW_FLAG"));
  assert.ok(!diffText.includes("rotated-456"));
  await page.click(".modal button:has-text('Reveal values')");
  await page.waitForSelector(".modal .var-value.shown");
  assert.ok((await page.locator(".modal").innerText()).includes("rotated-456"));
  await page.click(".modal button.primary:has-text('Close')");
  await page.locator("tbody tr").first().hover();
  await page.locator("button:has-text('View')").first().click();
  await page.waitForSelector(".modal table[aria-label='Variables in v2']");
  assert.ok(!(await page.locator(".modal").innerText()).includes("rotated-456"));
  await page.click(".modal button.primary:has-text('Close')");
  assert.equal(await page.locator("tbody tr").nth(0).locator("button:has-text('Roll back')").count(), 0);
  ok("history, compare and view keep values hidden until revealed; head has no rollback");

  // --- roll back to v1 creates v3
  await page.locator("tbody tr").nth(1).hover();
  await page.locator("tbody tr").nth(1).locator("button:has-text('Roll back')").click();
  await page.click(".modal button.primary:has-text('Roll back')");
  await page.waitForSelector("text=Saved as v3");
  await page.waitForFunction(() => document.querySelectorAll("table[aria-label='Version history'] tbody tr").length === 3);
  assert.ok((await page.locator("tbody tr").first().innerText()).includes("v3"));
  ok("rolls back to v1 as a new version v3");

  // --- Members: invite the guest to staging only
  await page.click("a.tab:has-text('Members')");
  await page.click("button:has-text('Invite someone')");
  await page.fill("#ie", guestEmail);
  await page.check("input[name=scope] >> nth=1");
  await page.selectOption("select[aria-label='Access to staging']", "read");
  await page.selectOption("#ix", "3");
  await page.click(".modal button.primary:has-text('Create invitation')");
  await page.waitForSelector("text=Invitation created");
  const link = await page.locator(".modal .code code").innerText();
  assert.ok(/\/invite\/svi_/.test(link));
  await page.click(".modal button.primary:has-text('Done')");
  await page.waitForSelector("table[aria-label='Pending invitations']");
  assert.ok((await page.locator("table[aria-label='Pending invitations']").innerText()).includes("expires in 3 days"));
  await page.locator("table[aria-label='Pending invitations'] tbody tr").first().hover();
  await page.click("table[aria-label='Pending invitations'] button:has-text('Extend')");
  await page.selectOption("#ed", "14");
  await page.click(".modal button.primary:has-text('Save')");
  await page.waitForSelector("text=Invitation extended");
  assert.ok((await page.locator("table[aria-label='Pending invitations']").innerText()).includes("expires in 14 days"));
  ok("creates an invitation limited to one environment, with an expiry that can be extended");

  // --- the guest accepts and only sees staging
  const gctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const guest = await gctx.newPage(); watch(guest);
  await guest.goto(`${base}/login`);
  await guest.fill("#email", guestEmail);
  await guest.fill("#password", pw);
  await guest.click("button.primary");
  await guest.waitForSelector("h1:has-text('Projects')");
  await guest.goto(link);
  await guest.click("button:has-text('Accept invitation')");
  await guest.click("button:has-text('Open project')");
  await guest.waitForSelector("h1:has-text('e2e-app')");
  assert.deepEqual(await guest.locator("nav[aria-label='Project'] .tab").allTextContents(), ["staging", "Members"]);
  assert.equal(await guest.locator("button:has-text('Edit variables')").count() + await guest.locator("button:has-text('Add variables')").count(), 0);
  ok("invited guest sees only the staging environment, read-only");
  await gctx.close();

  // --- settings: add an environment copied from development, then delete the project
  await page.click("a.tab:has-text('Settings')");
  await page.fill("#ne", "preview");
  await page.selectOption("select[aria-label='Copy variables from']", { label: "Copy from development" });
  await page.click("button:has-text('Add')");
  await page.waitForSelector("a.tab:has-text('preview')");
  await page.click("a.tab:has-text('preview')");
  await page.waitForSelector(".var-name");
  assert.equal(await page.locator(".var-name").count(), 3); // development was rolled back to v1
  ok("adds an environment copied from another");
  await page.click("a.tab:has-text('Settings')");
  await page.fill("#dn", "e2e-app");
  await page.click("button:has-text('Delete this project')");
  await page.waitForSelector("h1:has-text('Projects')");
  assert.equal(await page.locator("a[href^=\"/p/\"]").count(), 0); // gone from the list (it still appears in activity)
  ok("deletes the project after typing its name");

  // --- light mode switch: toggles, persists across reloads, and is also in Account > Appearance
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  assert.equal(await theme(), "dark");
  await page.click("button[aria-label='Switch to light mode']");
  assert.equal(await theme(), "light");
  await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(246, 246, 247)"); // fades over 150ms
  await page.reload(); await page.waitForSelector("h1:has-text('Projects')");
  assert.equal(await theme(), "light");
  await page.click("a[aria-label='Account']");
  await page.click("button[aria-pressed]:has-text('Dark')");
  assert.equal(await theme(), "dark");
  assert.equal(await page.evaluate(() => localStorage.getItem("sv.theme")), "dark");
  ok("light mode switch works, persists and syncs with Account > Appearance");

  // --- two-step verification: set up, sign in with it, backups, turn off
  await page.click("a[aria-label='Account']");
  await page.waitForSelector("section[aria-label='Two-step verification']");
  await page.click("button:has-text('Set up two-step verification')");
  await page.fill("#sp", "wrong password!");
  await page.click(".modal button.primary:has-text('Continue')");
  await page.waitForSelector(".modal .form-error:not(:empty)");
  await page.fill("#sp", pw);
  await page.click(".modal button.primary:has-text('Continue')");
  await page.waitForSelector(".qr img");
  assert.ok((await page.locator(".qr img").getAttribute("src")).startsWith("data:image/png"));
  const secret = (await page.locator(".secret-box").innerText()).replace(/\s/g, "");
  assert.match(secret, /^[A-Z2-7]{32}$/);
  await page.fill("#sc", "000000");
  await page.click(".modal button.primary:has-text('Turn on')");
  await page.waitForSelector(".modal .form-error:not(:empty)");
  await page.fill("#sc", totp(secret));
  await page.click(".modal button.primary:has-text('Turn on')");
  await page.waitForSelector(".recovery-grid");
  const recovery = await page.locator(".recovery-grid span").allTextContents();
  assert.equal(recovery.length, 10);
  assert.ok(await page.locator(".modal button.primary:has-text('Done')").isDisabled()); // must confirm they saved the codes
  await page.check(".modal input[type=checkbox]");
  await page.click(".modal button.primary:has-text('Done')");
  await page.waitForSelector("text=On since");
  ok("sets up two-step verification with a QR code and shows recovery codes once");

  // sign in again: password alone is not enough
  const signOut = async () => { await page.click("button[aria-label='Sign out']"); await page.waitForSelector("h1:has-text('Sign in')"); };
  const passwordStep = async () => { await page.fill("#email", `owen-${stamp}@e2e.test`); await page.fill("#password", pw); await page.click("button.primary.block"); await page.waitForSelector("h1:has-text('Two-step verification')"); };
  await signOut(); await passwordStep();
  assert.equal(await page.locator("nav[aria-label='Main']").count(), 0);
  const before = await page.locator("button.primary.block").boundingBox();
  await page.fill("#code", "000000");
  await page.click("button.primary.block");
  await page.waitForSelector(".form-error:not(:empty)");
  const after = await page.locator("button.primary.block").boundingBox();
  assert.equal(after.y, before.y); // the error does not move the button
  assert.ok((await page.locator(".form-error").innerText()).includes("attempts left"));
  await page.fill("#code", totp(secret, 1));
  await page.click("button.primary.block");
  await page.waitForSelector("nav[aria-label='Main']"); // back where they were, signed in
  ok("sign-in asks for a code, shows a wrong code without layout shift, accepts the authenticator code");

  if (MAIL_LOG) {
    await signOut(); await passwordStep();
    await page.click("button:has-text('Email me a code')");
    await page.waitForSelector("text=Code sent to");
    await page.waitForTimeout(400);
    const log = fs.readFileSync(MAIL_LOG, "utf8");
    const codes = [...log.matchAll(/sign-in code is (\d{6})/g)].map((m) => m[1]);
    assert.ok(codes.length, "an emailed code appears in the server log");
    await page.fill("#code", codes[codes.length - 1]);
    await page.click("button.primary.block");
    await page.waitForSelector("nav[aria-label='Main']"); // back where they were, signed in
    ok("signs in with an emailed code");
  }

  await signOut(); await passwordStep();
  await page.click("button:has-text('Use a recovery code')");
  await page.fill("#code", recovery[0]);
  await page.click("button.primary.block");
  await page.waitForSelector("nav[aria-label='Main']"); // back where they were, signed in
  await signOut(); await passwordStep();
  await page.click("button:has-text('Use a recovery code')");
  await page.fill("#code", recovery[0]);
  await page.click("button.primary.block");
  await page.waitForSelector(".form-error:not(:empty)");
  assert.equal(await page.locator("nav[aria-label='Main']").count(), 0); // a recovery code works only once
  await page.fill("#code", recovery[1]);
  await page.click("button.primary.block");
  await page.waitForSelector("nav[aria-label='Main']"); // back where they were, signed in
  ok("recovery codes work once each");

  await page.click("a[aria-label='Account']");
  await page.waitForSelector("text=8 of 10 unused");
  await page.click("section[aria-label='Two-step verification'] button:has-text('Turn off')");
  await page.fill("#cp", pw);
  await page.fill("#cc", recovery[2]);
  await page.click(".modal button.danger");
  await page.waitForSelector("button:has-text('Set up two-step verification')");
  ok("turns two-step verification off with password and a code");
  await signOut();
  await page.fill("#email", `owen-${stamp}@e2e.test`); await page.fill("#password", pw); await page.click("button.primary.block");
  await page.waitForSelector("nav[aria-label='Main']"); // back where they were, signed in

  // --- sign out
  await page.click("button[aria-label='Sign out']");
  await page.waitForSelector("h1:has-text('Sign in')");
  await page.goto(`${base}/`);
  await page.waitForSelector("h1:has-text('Sign in')");
  ok("signs out and protects the app");

  assert.deepEqual(errors, [], "no console or page errors: " + errors.join(" | "));
  ok("no console errors");
  await browser.close();
  console.log(`\n${step} checks passed`);
})().catch((e) => { console.error("E2E FAILED:", e.message); process.exit(1); });
