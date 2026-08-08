/* Katinen B — Night Run: browser tests.
 *
 *   npm i playwright
 *   python3 -m http.server 8765 &          # serve the repo root
 *   node test.mjs
 *
 * Three environments are covered, because the app behaves differently in each:
 *   1. a normal origin, where storage and GPS both work
 *   2. a normal origin with geolocation mocked, for the Find screen
 *   3. a sandboxed iframe with an opaque origin, where localStorage THROWS —
 *      this is what an embedded preview gives you, and it shipped broken once
 *      because every earlier test only ever exercised the happy path.
 */

import { chromium } from "playwright";
import { writeFileSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const BASE = process.env.BASE || "http://localhost:8765";
let pass = 0, fail = 0;

const t = async (label, fn) => {
  try {
    const ok = await fn();
    console.log(ok ? "  ok   " : "  FAIL ", label);
    ok ? pass++ : fail++;
  } catch (e) {
    console.log("  FAIL ", label, "—", e.message.split("\n")[0]);
    fail++;
  }
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

/* ------------------------------------------------------------------ 1. core */
console.log("\ncore, normal origin");
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await p.goto(BASE + "/index.html");
  await p.waitForTimeout(400);

  await t("six stops render", async () => (await p.locator(".stop").count()) === 6);
  await t("first stop is current", async () =>
    (await p.locator(".stop").first().getAttribute("class")).includes("current"));
  await t("no false storage warning", async () =>
    !(await p.locator("#pane-run").innerText()).includes("cannot save anything"));
  await t("partial-book warning", async () =>
    (await p.locator(".note.warn").first().innerText()).includes("Page 1 of 4"));
  await t("papers marked as a dated snapshot", async () =>
    /usually.*7 aug 2026/i.test(await p.locator("#stop-1096016\\:s5 .usual .lbl").innerText()));
  await t("flat list hides doors that take nothing", async () =>
    (await p.locator("#stop-1096016\\:s5 .apt").count()) === 7);

  await p.click("#bigBtn"); await p.waitForTimeout(150);
  await t("clock starts", async () =>
    (await p.locator("#bigBtn").innerText()).startsWith("Delivered"));
  await p.click("#bigBtn"); await p.waitForTimeout(150);
  await p.click("#bigBtn"); await p.waitForTimeout(250);
  await t("two stops delivered", async () => (await p.locator(".stop.done").count()) === 2);
  await p.click("#undoBtn"); await p.waitForTimeout(250);
  await t("undo restores one", async () => (await p.locator(".stop.done").count()) === 1);

  await p.click(".stop.current [data-skip]"); await p.waitForTimeout(250);
  await t("skip marks nothing-tonight", async () => (await p.locator(".stop.skipped").count()) === 1);
  await t("skip is not counted as a delivery", async () =>
    (await p.locator(".stop.done").count()) === 1);
  await p.click("#undoBtn"); await p.waitForTimeout(250);
  await t("skip undoes", async () => (await p.locator(".stop.skipped").count()) === 0);

  await p.fill("#stop-1096016\\:s2 textarea", "gate code 4471");
  await p.waitForTimeout(600);
  await p.reload(); await p.waitForTimeout(500);
  await t("notes persist across reload", async () =>
    (await p.inputValue("#stop-1096016\\:s2 textarea")) === "gate code 4471");
  await t("ticks persist across reload", async () => (await p.locator(".stop.done").count()) === 1);

  await p.click('[data-pane="data"]'); await p.waitForTimeout(200);
  await p.fill("#f-street", "Testikatu"); await p.fill("#f-nr", "9");
  await p.fill("#f-papers", "HS 2, HASA 3");
  await p.fill("#f-apts", "1st floor: A1 HS, A2 -, A3 HASA");
  await p.click("[data-add-stop]"); await p.waitForTimeout(300);
  await p.click('[data-pane="run"]'); await p.waitForTimeout(200);
  await t("stop can be added by hand", async () => (await p.locator(".stop").count()) === 7);
  await t("papers parse", async () =>
    (await p.locator(".stop").last().innerText()).includes("HS 2"));
  await t("flats parse", async () =>
    (await p.locator(".stop").last().locator(".apt").count()) === 2);

  await p.click('[data-pane="routes"]'); await p.waitForTimeout(150);
  await p.click("[data-mode-toggle]"); await p.waitForTimeout(150);
  await t("amber night mode", async () =>
    (await p.locator("html").getAttribute("data-mode")) === "amber");

  await t("page never scrolls sideways", async () =>
    await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await t("no uncaught errors", async () => errs.length === 0);
  await ctx.close();
}

/* -------------------------------------------------------------- 2. find/gps */
console.log("\nfind, with a mocked fix");
{
  const A = { latitude: 61.0015, longitude: 24.46 };
  const B = { latitude: 61.0031, longitude: 24.46 };   // ~178 m due north
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["geolocation"], geolocation: { ...A, accuracy: 8 }
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await p.goto(BASE + "/index.html");
  await p.waitForTimeout(500);

  await p.click("#bigBtn"); await p.waitForTimeout(600);
  await p.click("#bigBtn"); await p.waitForTimeout(500);
  await t("delivering pins the door", async () =>
    await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("pp.pos.v1") || "{}")).length === 1));

  await ctx.setGeolocation({ ...B, accuracy: 8 }); await p.waitForTimeout(700);
  await p.click("#bigBtn"); await p.waitForTimeout(500);
  await p.click(".stop.current [data-pin]"); await p.waitForTimeout(400);
  await t("manual pin works", async () => (await p.locator(".stop.current .pin.set").count()) === 1);

  await p.click('[data-pane="find"]'); await p.waitForTimeout(800);
  await t("distance is shown", async () => /\d/.test(await p.locator(".readout .dist").innerText()));
  await t("arrow is rotated", async () =>
    (await p.locator("#arrow").getAttribute("style") || "").includes("rotate"));
  await t("gps quality reads good", async () =>
    (await p.locator(".gpsline").getAttribute("class")).includes("good"));
  await t("distance A→B is ~178 m", async () => {
    const txt = await p.locator(".near .d").last().innerText();
    const m = parseInt(txt, 10);
    return m >= 168 && m <= 188;
  });
  await t("map is drawn", async () => await p.evaluate(() => {
    const c = document.querySelector("#minimap");
    if (!c) return false;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const bg = d[0] + "," + d[1] + "," + d[2];
    let diff = 0;
    for (let i = 0; i < d.length; i += 4)
      if (d[i] + "," + d[i + 1] + "," + d[i + 2] !== bg) diff++;
    return diff > 1500 && diff < (d.length / 4) * 0.25;   // drawn, but not a wash
  }));
  await t("map background is not tinted over", async () => await p.evaluate(() => {
    const d = document.querySelector("#minimap").getContext("2d").getImageData(2, 2, 1, 1).data;
    return d[0] === 14 && d[1] === 20 && d[2] === 32;
  }));

  const jpg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "base64");
  await p.click('[data-pane="run"]'); await p.waitForTimeout(300);
  await p.setInputFiles(".stop.current [data-shot]",
    { name: "door.jpg", mimeType: "image/jpeg", buffer: jpg });
  await p.waitForTimeout(900);
  await t("door photo saves", async () => (await p.locator(".stop.current .shot img").count()) === 1);
  await p.reload(); await p.waitForTimeout(900);
  await t("photo survives reload", async () => (await p.locator(".stop.current .shot img").count()) === 1);
  await t("pins survive reload", async () => (await p.locator(".pin.set").count()) >= 2);
  await t("no uncaught errors", async () => errs.length === 0);
  await ctx.close();
}

/* ------------------------------------------------ 3. opaque origin (sandbox) */
console.log("\nsandboxed iframe, opaque origin — localStorage throws");
{
  // Mirror how an embedded preview wraps the file, then deny it a same origin.
  const dir = mkdtempSync(join(tmpdir(), "kb-sandbox-"));
  const body = readFileSync("index.html", "utf-8");
  writeFileSync(join(dir, "inner.html"),
    "<!doctype html><html><head><meta charset='utf-8'></head><body>\n" + body + "\n</body></html>");
  writeFileSync(join(dir, "host.html"),
    "<!doctype html><meta charset='utf-8'>" +
    "<iframe id='f' src='inner.html' sandbox='allow-scripts' style='width:420px;height:900px;border:0'></iframe>");

  const ctx = await browser.newContext({ viewport: { width: 460, height: 940 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await p.goto("file://" + join(dir, "host.html"));
  await p.waitForTimeout(1200);
  const f = p.frames().find(fr => fr.url().includes("inner.html"));

  await t("the app still boots", async () => !!f && (await f.locator(".stop").count()) === 6);
  await t("header renders", async () => (await f.locator("#hdrRoute").innerText()) === "1096016");
  await t("it admits it cannot save", async () =>
    (await f.locator(".note.warn").first().innerText()).includes("cannot save anything"));
  await f.click("#bigBtn"); await p.waitForTimeout(200);
  await f.click("#bigBtn"); await p.waitForTimeout(300);
  await t("delivering still works in memory", async () => (await f.locator(".stop.done").count()) === 1);
  await f.click('[data-pane="help"]'); await p.waitForTimeout(250);
  await t("other panes render", async () => (await f.locator("#pane-help .card").count()) >= 4);
  await t("no uncaught errors", async () => errs.length === 0);
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
