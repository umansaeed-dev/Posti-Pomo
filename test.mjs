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

  await t("all 13 stops render", async () => (await p.locator(".stop").count()) === 13);
  await t("first stop is current", async () =>
    (await p.locator(".stop").first().getAttribute("class")).includes("current"));
  await t("route runs in Pomo order", async () => {
    const want = ["Lautatarhankatu 5", "Talaskuja 1", "Talaskuja 3", "Wähäjärvenkatu 6",
      "Wähäjärvenkatu 5", "Wähäjärvenkatu 3", "Wähäjärvenkatu 1", "Salamanteri 3",
      "Korentokatu 6", "Pikkujärventie 6", "Aittatie 7", "Aittatie 5", "Aittatie 1"];
    const got = await p.locator(".stop .addr").evaluateAll(els =>
      els.map(e => e.querySelector(".street").textContent.trim() + " " +
                   e.querySelector(".nr").childNodes[0].textContent.trim()));
    return JSON.stringify(got) === JSON.stringify(want);
  });
  await t("no false storage warning", async () =>
    !(await p.locator("#pane-run").innerText()).includes("cannot save anything"));
  await t("book is complete, no partial-page warning", async () =>
    !(await p.locator("#pane-run").innerText()).includes("of 4 entered"));
  await t("nurses' office rule is flagged", async () =>
    (await p.locator("#stop-1096016\\:s10 .note.warn").innerText()).includes("NURSES"));
  await t("no door code anywhere in the file", async () => {
    // Every code the delivery book has shown. These are live building-access
    // codes and the repository is public; they belong in the per-stop note,
    // which never leaves the phone.
    const src = readFileSync("index.html", "utf-8");
    return !/\b(3830|4736|1510|0106|1829|1975)\b/.test(src);
  });
  await t("papers marked as a dated snapshot", async () =>
    /usually.*8 aug 2026/i.test(await p.locator("#stop-1096016\\:s5 .usual .lbl").innerText()));
  await t("flat list hides doors that take nothing", async () =>
    (await p.locator("#stop-1096016\\:s5 .apt").count()) === 6);
  // A stop that map apps cannot place is a dropped stop. This shipped once:
  // "Pokrinniemi 30 / 22 / 15 / 17" was read by Google as house number 30 and
  // the other three were silently lost. Runs over EVERY route, so it also
  // guards the ones not yet entered.
  await t("every address on every route is geocodable", async () => {
    const bad = [];
    for(const rid of ["1096016","1096017","1096018","1096019","1096020"]){
      await p.click('[data-pane="routes"]'); await p.waitForTimeout(150);
      await p.click(`[data-route="${rid}"]`); await p.waitForTimeout(300);
      const nrs = await p.locator(".stop .addr .nr").evaluateAll(els =>
        els.map(e => e.childNodes[0].textContent.trim()));
      // A Finnish house number: digits, optionally one letter (3a, 3b), nothing else.
      nrs.forEach(n => { if(!/^\d+\s?[a-zA-Z]?$/.test(n)) bad.push(rid + " → " + n); });
    }
    if(bad.length) console.log("      unplaceable:", bad.join(", "));
    return bad.length === 0;
  });
  await t("no address carries a postcode that could contradict its street", async () => {
    await p.click('[data-pane="routes"]'); await p.waitForTimeout(150);
    await p.click('[data-route="1096018"]'); await p.waitForTimeout(300);
    const hrefs = await p.locator("a.wr-g").evaluateAll(a => a.map(x => x.href));
    // 1096018 is 13210 country; a hardcoded 13110 anywhere means the old bug.
    return hrefs.every(h => !/131\d\d|132\d\d/.test(decodeURIComponent(h)));
  });
  await p.click('[data-pane="routes"]'); await p.waitForTimeout(150);
  await p.click('[data-route="1096016"]'); await p.waitForTimeout(300);

  await t("every paper has an address", async () =>
    !(await p.locator("#pane-data,#pane-run").allInnerTexts()).join(" ").includes("had no address"));

  // maps hand-off
  await t("whole route offers both map apps", async () => {
    const hrefs = await p.locator(".wholeroute a").evaluateAll(a => a.map(x => x.href));
    return hrefs.some(h => h.includes("google.com/maps/dir")) &&
           hrefs.some(h => h.includes("maps.apple.com/?daddr="));
  });

  // The bug this replaced: one link silently dropped 7 of 18 stops.
  const everyStopCovered = async (sel, extract) => {
    const want = await p.locator(".stop .addr").evaluateAll(els =>
      els.map(e => e.querySelector(".street").textContent.trim() + " " +
                   e.querySelector(".nr").childNodes[0].textContent.trim()));
    const hrefs = await p.locator(sel).evaluateAll(a => a.map(x => x.href));
    const seen = new Set();
    for(const h of hrefs) for(const addr of extract(h)) seen.add(addr);
    return want.every(w => seen.has(w));
  };
  const addrsFromGoogle = h => {
    const u = new URL(h);
    const parts = [u.searchParams.get("origin"), u.searchParams.get("destination")]
      .concat((u.searchParams.get("waypoints") || "").split("|").filter(Boolean));
    return parts.filter(Boolean).map(a => a.split(",")[0]);
  };
  const addrsFromApple = h => decodeURIComponent(new URL(h).search)
    .replace("?daddr=", "").replace("&dirflg=d", "")
    .split("+to:").map(a => a.split(",")[0]);

  await t("Google parts cover every stop, none dropped", async () =>
    await everyStopCovered("a.wr-g", addrsFromGoogle));
  await t("Apple parts cover every stop, none dropped", async () =>
    await everyStopCovered("a.wr-a", addrsFromApple));
  await t("no single Google part exceeds the 9-waypoint limit", async () => {
    const hrefs = await p.locator("a.wr-g").evaluateAll(a => a.map(x => x.href));
    return hrefs.every(h => {
      const w = new URL(h).searchParams.get("waypoints");
      return !w || w.split("|").length <= 9;
    });
  });
  await t("parts overlap so no leg is lost between them", async () => {
    const hrefs = await p.locator("a.wr-g").evaluateAll(a => a.map(x => x.href));
    for(let i = 1; i < hrefs.length; i++){
      const prevEnd = new URL(hrefs[i-1]).searchParams.get("destination");
      const thisStart = new URL(hrefs[i]).searchParams.get("origin");
      if(prevEnd !== thisStart) return false;
    }
    return true;
  });

  await t("per-stop links follow the Google preference", async () => {
    const h = await p.locator("#stop-1096016\\:s5 .navrow a").first().getAttribute("href");
    return h.includes("google.com/maps/dir");
  });
  await p.click('[data-pane="routes"]'); await p.waitForTimeout(150);
  await p.click('[data-maps="apple"]'); await p.waitForTimeout(250);
  await p.click('[data-pane="run"]'); await p.waitForTimeout(250);
  await t("per-stop links switch to Apple", async () => {
    const h = await p.locator("#stop-1096016\\:s5 .navrow a").first().getAttribute("href");
    return h.startsWith("https://maps.apple.com/?daddr=") && h.includes("dirflg=d");
  });
  await t("Look Around label under Apple", async () =>
    (await p.locator("#stop-1096016\\:s5 .navrow a").nth(1).innerText()).includes("Look Around"));
  await t("both whole-route buttons remain under Apple", async () => {
    const hrefs = await p.locator(".wholeroute a").evaluateAll(a => a.map(x => x.href));
    return hrefs.some(h => h.includes("google.com/maps/dir")) &&
           hrefs.some(h => h.includes("maps.apple.com/?daddr="));
  });
  await p.click('[data-pane="routes"]'); await p.waitForTimeout(150);
  await p.click('[data-maps="google"]'); await p.waitForTimeout(250);
  await p.click('[data-pane="run"]'); await p.waitForTimeout(250);


  await t("route 1096017 is complete and in order", async () => {
    await p.click('[data-pane="routes"]'); await p.waitForTimeout(200);
    await p.click('[data-route="1096017"]'); await p.waitForTimeout(400);
    const want = ["Lautatarhankatu 5","Pikkujärventie 7","Pikkujärventie 8","Pikkujärventie 9",
      "Hilpi Kummilan Tie 2","Hilpi Kummilan Tie 4","Hilpi Kummilan Tie 6","Korentokatu 2",
      "Korentokatu 4","Keinukatu 10","Keinukatu 7","Keinukatu 5","Keinukatu 4","Keinukatu 2",
      "Keinukatu 1","Hilpinkuja 3","Kummilankuja 4","Hilpi Kummilan Tie 16"];
    const got = await p.locator(".stop .addr").evaluateAll(els =>
      els.map(e => e.querySelector(".street").textContent.trim() + " " +
                   e.querySelector(".nr").childNodes[0].textContent.trim()));
    return JSON.stringify(got) === JSON.stringify(want);
  });
  await t("1096017 papers reconcile, nothing unplaced", async () => {
    await p.click('[data-pane="data"]'); await p.waitForTimeout(300);
    const txt = await p.locator("#pane-data").innerText();
    await p.click('[data-pane="run"]'); await p.waitForTimeout(200);
    return !txt.includes("had no address");
  });
  await t("route 1096018 is complete and in order", async () => {
    await p.click('[data-pane="routes"]'); await p.waitForTimeout(200);
    await p.click('[data-route="1096018"]'); await p.waitForTimeout(400);
    const want = ["Lautatarhankatu 5","Katistentie 98","Katistentie 96","Katistentie 91",
      "Raatarinpolku 3","Hopeapellontie 2","Hopeapellontie 4","Hopeapellontie 6",
      "Hopeapellontie 5","Idänpääntie 1","Idänpääntie 3b","Idänpääntie 3a","Pokrinniemi 12",
      "Pokrinniemi 17","Pokrinniemi 22","Idänpääntie 6","Idänpääntie 3c",
      "Idänpääntie 5","Nuottatie 2","Idänpääntie 12","Verkkotie 6","Verkkotie 3",
      "Verkkotie 5","Mertapolku 2","Katistentie 100"];
    const got = await p.locator(".stop .addr").evaluateAll(els =>
      els.map(e => e.querySelector(".street").textContent.trim() + " " +
                   e.querySelector(".nr").childNodes[0].textContent.trim()));
    return JSON.stringify(got) === JSON.stringify(want);
  });
  await t("1096018 papers reconcile, nothing unplaced", async () => {
    await p.click('[data-pane="data"]'); await p.waitForTimeout(300);
    const txt = await p.locator("#pane-data").innerText();
    await p.click('[data-pane="run"]'); await p.waitForTimeout(200);
    return !txt.includes("had no address");
  });
  await t("the unverified Pokrinniemi stretch says so", async () =>
    (await p.locator("#stop-1096018\\:c14 .note.warn").innerText()).includes("CHECK THIS ONE"));
  await t("route 1096019 is complete, 71 stops, reconciled", async () => {
    await p.click('[data-pane="routes"]'); await p.waitForTimeout(200);
    await p.click('[data-route="1096019"]'); await p.waitForTimeout(500);
    const n = await p.locator(".stop").count();
    await p.click('[data-pane="data"]'); await p.waitForTimeout(300);
    const txt = await p.locator("#pane-data").innerText();
    await p.click('[data-pane="run"]'); await p.waitForTimeout(200);
    return n === 71 && !txt.includes("had no address");
  });
  await t("1096019 starts at the depot and ends at Myllypellontie 14", async () => {
    const got = await p.locator(".stop .addr").evaluateAll(els =>
      els.map(e => e.querySelector(".street").textContent.trim() + " " +
                   e.querySelector(".nr").childNodes[0].textContent.trim()));
    return got[0] === "Lautatarhankatu 5" && got[got.length-1] === "Myllypellontie 14";
  });
  await t("both address-sharing buildings are flagged", async () =>
    (await p.locator("#stop-1096019\\:d18 .note.warn").innerText()).includes("TWO street addresses") &&
    (await p.locator("#stop-1096019\\:d20 .note.warn").innerText()).includes("KATISTENTIE 107"));
  await t("Viipurintie 36's second box group is flagged", async () =>
    (await p.locator("#stop-1096019\\:d26 .note.warn").innerText()).includes("TWO separate box groups"));
  await t("route 1096020 is complete and reconciled", async () => {
    await p.click('[data-pane="routes"]'); await p.waitForTimeout(200);
    await p.click('[data-route="1096020"]'); await p.waitForTimeout(400);
    const want = ["Lautatarhankatu 5","Honkalankatu 2","Honkalankatu 1","Honkalankatu 3",
      "Tyllilänkatu 1","Tyllilänkatu 3","Tyllilänkatu 5","Heikkilänkatu 4",
      "Heikkilänkatu 9","Heikkilänkatu 7","Heikkilänkatu 1"];
    const got = await p.locator(".stop .addr").evaluateAll(els =>
      els.map(e => e.querySelector(".street").textContent.trim() + " " +
                   e.querySelector(".nr").childNodes[0].textContent.trim()));
    await p.click('[data-pane="data"]'); await p.waitForTimeout(300);
    const txt = await p.locator("#pane-data").innerText();
    await p.click('[data-pane="run"]'); await p.waitForTimeout(200);
    return JSON.stringify(got) === JSON.stringify(want) && !txt.includes("had no address");
  });
  await t("every route in the book is now entered", async () => {
    for(const rid of ["1096016","1096017","1096018","1096019","1096020"]){
      await p.click('[data-pane="routes"]'); await p.waitForTimeout(150);
      await p.click(`[data-route="${rid}"]`); await p.waitForTimeout(300);
      if((await p.locator(".stop").count()) === 0) return false;
      if((await p.locator("#pane-run").innerText()).includes("of 7 entered")) return false;
    }
    return true;
  });
  await p.click('[data-pane="routes"]'); await p.waitForTimeout(150);
  await p.click('[data-route="1096019"]'); await p.waitForTimeout(400);

  await t("the longest route still covers every stop on the map", async () =>
    await everyStopCovered("a.wr-g", addrsFromGoogle));
  await p.click('[data-pane="routes"]'); await p.waitForTimeout(200);
  await p.click('[data-route="1096018"]'); await p.waitForTimeout(400);

  await t("the quiet-stairs request is carried", async () =>
    (await p.locator("#stop-1096018\\:c21 .note.warn").innerText()).includes("quietly"));
  // The 25-stop route is where the map-link splitting is most likely to fail,
  // so assert coverage on the biggest round rather than only the smallest.
  await t("Google parts cover all 25 stops of the longest route", async () =>
    await everyStopCovered("a.wr-g", addrsFromGoogle));
  await t("Apple parts cover all 25 stops of the longest route", async () =>
    await everyStopCovered("a.wr-a", addrsFromApple));
  await t("longest route splits into parts within Google's limit", async () => {
    const hrefs = await p.locator("a.wr-g").evaluateAll(a => a.map(x => x.href));
    return hrefs.length === 3 && hrefs.every(h => {
      const w = new URL(h).searchParams.get("waypoints");
      return !w || w.split("|").length <= 9;
    });
  });
  await p.click('[data-pane="routes"]'); await p.waitForTimeout(200);
  await p.click('[data-route="1096017"]'); await p.waitForTimeout(400);

  await t("Korentokatu 4 corridor rule is flagged", async () =>
    (await p.locator("#stop-1096017\\:b9 .note.warn").innerText()).includes("CORRIDOR"));
  await p.click('[data-pane="routes"]'); await p.waitForTimeout(200);
  await p.click('[data-route="1096016"]'); await p.waitForTimeout(400);

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
  await t("stop can be added by hand", async () => (await p.locator(".stop").count()) === 14);
  await t("papers parse", async () =>
    (await p.locator(".stop").last().innerText()).includes("HS 2"));
  await t("flats parse", async () =>
    (await p.locator(".stop").last().locator(".apt").count()) === 2);

  // whole-route overview
  await p.click('[data-view="all"]'); await p.waitForTimeout(300);
  // 14 by now: the 13 real stops plus the one added by hand above.
  await t("overview lists every stop", async () => (await p.locator(".rrow").count()) === 14);
  await t("overview keeps Pomo order", async () => {
    const got = await p.locator(".rrow .ad").evaluateAll(els =>
      els.map(e => e.childNodes[0].textContent.trim()));
    return got[0] === "Lautatarhankatu 5" && got[9] === "Pikkujärventie 6" && got[12] === "Aittatie 1";
  });
  await t("overview shows the legs", async () =>
    (await p.locator(".rrow .lg").first().innerText()).includes("Posti yard"));
  await t("overview fits without sideways scroll", async () =>
    await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await t("can tick from the overview", async () => {
    const before = await p.locator(".rrow.settled").count();
    await p.locator(".rrow .tk").nth(4).click(); await p.waitForTimeout(250);
    return (await p.locator(".rrow.settled").count()) === before + 1;
  });
  await t("tapping a row opens the working view there", async () => {
    await p.locator(".rrow").nth(9).click(); await p.waitForTimeout(400);
    return (await p.locator(".stop").count()) === 14 &&
           (await p.locator(".rrow").count()) === 0;
  });
  await t("view choice survives reload", async () => {
    await p.click('[data-view="all"]'); await p.waitForTimeout(250);
    await p.reload(); await p.waitForTimeout(500);
    return (await p.locator(".rrow").count()) === 14;
  });
  await p.click('[data-view="work"]'); await p.waitForTimeout(300);

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

  await t("the app still boots", async () => !!f && (await f.locator(".stop").count()) === 13);
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
