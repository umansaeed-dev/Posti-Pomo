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
  /* The Valkeakoski bug. "Heikkilänkatu 4, Hämeenlinna, Finland" with no
     postcode resolved to Heikkilänkatu 4, 37600 Valkeakoski — 20 km away, and
     it turned the last round into a 49 km drive. Street names repeat across
     Finnish municipalities and a geocoder is free to ignore the town, so every
     address must carry its own postcode, and that postcode must be one of the
     three this round actually crosses. */
  await t("every address on every route carries a Hämeenlinna postcode", async () => {
    const bad = [];
    for(const rid of ["1096016","1096017","1096018","1096019","1096020"]){
      await p.click('[data-pane="routes"]'); await p.waitForTimeout(150);
      await p.click(`[data-route="${rid}"]`); await p.waitForTimeout(300);
      const hrefs = await p.locator("a.wr-g, a.wr-a, a.wn-g, a.wn-a").evaluateAll(a => a.map(x => x.href));
      for(const h of hrefs){
        const url = decodeURIComponent(h);
        // Pull each address out of the query and check it individually, so a
        // single good one can't mask a bare neighbour.
        for(const addr of url.split(/[|+]to:|&|\?/).join("|").split("|")){
          if(!/Hämeenlinna, Finland/.test(addr)) continue;
          if(!/\b(13110|13200|13210) Hämeenlinna, Finland/.test(addr)) bad.push(rid + " → " + addr.trim());
        }
      }
    }
    if(bad.length) console.log("      no postcode:", [...new Set(bad)].slice(0,6).join(" ; "));
    return bad.length === 0;
  });
  await t("no address resolves to another municipality", async () => {
    const bad = [];
    for(const rid of ["1096016","1096017","1096018","1096019","1096020"]){
      await p.click('[data-pane="routes"]'); await p.waitForTimeout(150);
      await p.click(`[data-route="${rid}"]`); await p.waitForTimeout(300);
      const hrefs = await p.locator("a.wr-g, a.wr-a, a.wn-g, a.wn-a").evaluateAll(a => a.map(x => x.href));
      hrefs.forEach(h => {
        const u = decodeURIComponent(h);
        // 37600 is Valkeakoski. Anything outside 131xx/132xx is off this round.
        (u.match(/\b\d{5}\b/g) || []).forEach(z => {
          if(!/^13(1|2)\d\d$/.test(z)) bad.push(rid + " → " + z);
        });
      });
    }
    if(bad.length) console.log("      foreign postcode:", [...new Set(bad)].join(", "));
    return bad.length === 0;
  });
  await t("every street in the book has its own looked-up postcode", async () => {
    const missing = await p.evaluate(() => {
      const out = [];
      for(const r of DATA.routes) for(const s of (r.stops || []))
        if(!POSTCODE[s.street]) out.push(r.id + " → " + s.street);
      return [...new Set(out)];
    });
    if(missing.length) console.log("      streets with no entry:", missing.join(", "));
    return missing.length === 0;
  });
  await t("Heikkilänkatu 4 is the Hämeenlinna one", async () => {
    await p.click('[data-pane="routes"]'); await p.waitForTimeout(150);
    await p.click('[data-route="1096020"]'); await p.waitForTimeout(300);
    const all = (await p.locator("a.wr-g, a.wr-a, a.wn-g, a.wn-a").evaluateAll(a => a.map(x => x.href)))
      .map(decodeURIComponent).join(" ");
    return all.includes("Heikkilänkatu 4, 13210 Hämeenlinna, Finland")
        && !/37600|Valkeakoski/.test(all);
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

  /* ---- the whole night: all five routes as one chain --------------------
     Same class of bug as the one that dropped 7 of 18 stops, but with 138 to
     drop instead of 18, so it gets the same treatment: prove every stop of
     every route appears somewhere in the set, prove no part is over the cap,
     and prove the parts join up. */
  await p.click('[data-pane="routes"]'); await p.waitForTimeout(250);

  const nightWant = () => p.evaluate(() =>
    DATA.routes.flatMap(r => (r.stops || []).map(s => s.street + " " + s.nr)));

  await t("the whole night exists and is split into parts", async () => {
    const n = await p.locator("a.wn-g").count();
    const blurb = await p.locator("#night-blurb").innerText();
    return n > 1 && /138 stops/.test(blurb) && /5 routes/.test(blurb);
  });
  await t("Google covers all 138 stops of the night, none dropped", async () => {
    const want = await nightWant();
    const hrefs = await p.locator("a.wn-g").evaluateAll(a => a.map(x => x.href));
    const seen = new Set();
    for(const h of hrefs) for(const a of addrsFromGoogle(h)) seen.add(a);
    const missing = want.filter(w => !seen.has(w));
    if(missing.length) console.log("      missing from night:", [...new Set(missing)].slice(0,8).join(", "));
    return want.length === 138 && missing.length === 0;
  });
  await t("Apple covers all 138 stops of the night, none dropped", async () => {
    const want = await nightWant();
    const hrefs = await p.locator("a.wn-a").evaluateAll(a => a.map(x => x.href));
    const seen = new Set();
    for(const h of hrefs) for(const a of addrsFromApple(h)) seen.add(a);
    const missing = want.filter(w => !seen.has(w));
    if(missing.length) console.log("      missing from night:", [...new Set(missing)].slice(0,8).join(", "));
    return missing.length === 0;
  });
  await t("no night part exceeds Google's 9-waypoint limit", async () => {
    const hrefs = await p.locator("a.wn-g").evaluateAll(a => a.map(x => x.href));
    return hrefs.length > 0 && hrefs.every(h => {
      const w = new URL(h).searchParams.get("waypoints");
      return !w || w.split("|").length <= 9;
    });
  });
  await t("night parts overlap so no leg is lost between routes", async () => {
    const hrefs = await p.locator("a.wn-g").evaluateAll(a => a.map(x => x.href));
    for(let i = 1; i < hrefs.length; i++)
      if(new URL(hrefs[i-1]).searchParams.get("destination") !==
         new URL(hrefs[i]).searchParams.get("origin")) return false;
    return true;
  });
  await t("the night runs in Pomo order, route after route", async () => {
    const want = await nightWant();
    const hrefs = await p.locator("a.wn-g").evaluateAll(a => a.map(x => x.href));
    // addrsFromGoogle returns origin+destination first, which is fine for a
    // coverage check and useless for an ordering one. Walk the link properly.
    const inOrder = h => {
      const u = new URL(h);
      return [u.searchParams.get("origin")]
        .concat((u.searchParams.get("waypoints") || "").split("|").filter(Boolean))
        .concat([u.searchParams.get("destination")])
        .map(a => a.split(",")[0]);
    };
    // Rebuild the chain from the links, dropping each seam stop's repeat.
    const chain = [];
    hrefs.forEach((h, i) => inOrder(h).forEach((a, j) => {
      if(i && j === 0) return;          // the seam: already the previous part's end
      chain.push(a);
    }));
    return chain.length === want.length && chain.every((a, i) => a === want[i]);
  });
  await t("each night part is labelled with the routes it spans", async () => {
    const tags = await p.locator(".nightlist .nrow .nd b").allInnerTexts();
    const ids = ["1096016","1096017","1096018","1096019","1096020"];
    return tags.length > 1 && tags.every(x => ids.some(id => x.includes(id)));
  });
  /* The combined map is drawn from his own pins, so on a fresh phone there is
     nothing to draw. Silence would read as a broken feature — it has to either
     show the map or say why it can't. */
  await t("the combined map either draws or says why it cannot", async () => {
    const txt = await p.locator("#pane-routes").innerText();
    const drawn = await p.locator("#nightmap").count();
    return drawn ? /doors pinned/i.test(txt) : /every door on it/i.test(txt);
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

  /* ---- the combined all-routes map ---------------------------------------
     Everything above pins doors on one route, so the whole-night map takes its
     "nothing to draw yet" branch and the drawing code never actually runs. Pin
     a couple of doors on a second route and make it draw for real — a canvas
     that throws or comes out blank would otherwise ship unnoticed. */
  await ctx.setGeolocation({ latitude: 61.0048, longitude: 24.4642, accuracy: 8 });
  await p.click('[data-pane="routes"]'); await p.waitForTimeout(200);
  await p.click('[data-route="1096017"]'); await p.waitForTimeout(450);
  await p.click("#bigBtn"); await p.waitForTimeout(600);
  await ctx.setGeolocation({ latitude: 61.0056, longitude: 24.4669, accuracy: 8 });
  await p.waitForTimeout(750);
  await p.click("#bigBtn"); await p.waitForTimeout(600);
  await p.click('[data-pane="routes"]'); await p.waitForTimeout(500);

  await t("the all-routes map draws once two routes have pins", async () => await p.evaluate(() => {
    const c = document.querySelector("#nightmap");
    if(!c) return false;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const bg = d[0] + "," + d[1] + "," + d[2];
    let diff = 0;
    for(let i = 0; i < d.length; i += 4)
      if(d[i] + "," + d[i+1] + "," + d[i+2] !== bg) diff++;
    return diff > 1500 && diff < (d.length / 4) * 0.25;   // drawn, but not a wash
  }));
  await t("each route on the combined map gets its own colour", async () => await p.evaluate(() => {
    const d = document.querySelector("#nightmap")
      .getContext("2d").getImageData(0, 0, 900, 900).data;
    const has = ([r, g, b]) => {
      for(let i = 0; i < d.length; i += 4)
        if(Math.abs(d[i]-r) < 10 && Math.abs(d[i+1]-g) < 10 && Math.abs(d[i+2]-b) < 10) return true;
      return false;
    };
    return has([255,130,0]) && has([61,220,151]);         // 1096016 and 1096017
  }));
  await t("the combined map counts pins from every route, not just this one", async () => {
    const cap = await p.locator(".mapwrap .cap").last().innerText();
    const m = cap.match(/(\d+) pinned/);
    return !!m && +m[1] >= 4;
  });
  await t("the whole-night links survive a route switch", async () =>
    (await p.locator("a.wn-g").count()) > 1 && (await p.locator("a.wn-a").count()) > 1);

  await t("no uncaught errors", async () => errs.length === 0);
  await ctx.close();
}

/* --------------------------------------------------- 2b. address lookup */
console.log("\naddress lookup, mocked geocoder");
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));

  /* Deterministic geocoder: coordinates derived from the query text, spread
     around Hämeenlinna — except one street, which "resolves" 40 km away the
     way Heikkilänkatu once resolved to Valkeakoski, and one that finds
     nothing. The app must keep the first out of the cache and survive the
     second. */
  let calls = 0;
  await p.route("https://nominatim.openstreetmap.org/**", async route => {
    calls++;
    const q = decodeURIComponent(new URL(route.request().url()).searchParams.get("q"));
    if(/Salamanteri/.test(q)) return route.fulfill({ json: [] });                    // not found
    if(/Mertapolku/.test(q))                                                        // wrong town
      return route.fulfill({ json: [{ lat: "61.26", lon: "24.03" }] });
    let h = 0;
    for(const ch of q) h = (h * 31 + ch.charCodeAt(0)) % 9973;
    return route.fulfill({ json: [{ lat: String(61.0 + (h % 89) / 8900),
                                    lon: String(24.46 + (h % 97) / 4850) }] });
  });

  await p.goto(BASE + "/index.html");
  await p.waitForTimeout(400);
  await p.evaluate(() => { LOOKUP.delay = 0; });        // no 1.15 s/req in tests
  await p.click('[data-pane="routes"]'); await p.waitForTimeout(250);

  await t("the lookup button offers every unique address once", async () => {
    const label = await p.locator("[data-lookup]").innerText();
    const uniq = await p.evaluate(() => lookupJobs().all.length);
    // 138 stops but the depot opens all five routes, so five of them collapse.
    return uniq === 134 && label.includes("134");
  });

  await p.click("[data-lookup]");
  await p.waitForFunction(() => !LOOKUP.running &&
    Object.keys(JSON.parse(localStorage.getItem("pp.addrpos.v1") || "{}")).length >= 132,
    null, { timeout: 30000 });
  await p.waitForTimeout(400);

  await t("one request per unique address, none repeated", async () => calls === 134);
  await t("good results are cached for offline use", async () => {
    const n = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("pp.addrpos.v1") || "{}")).length);
    return n === 132;                                    // 134 minus the two bad ones
  });
  await t("a result in the wrong town is rejected, not cached", async () =>
    await p.evaluate(() => !JSON.parse(localStorage.getItem("pp.addrpos.v1"))["mertapolku 2"]));
  await t("a not-found address stays pin-on-first-visit", async () =>
    await p.evaluate(() => !JSON.parse(localStorage.getItem("pp.addrpos.v1"))["salamanteri 3"]));
  await t("misses are offered again, successes are not", async () => {
    const label = await p.locator("[data-lookup]").innerText();
    return label.includes("132 of 134");
  });

  await t("the whole-night map now draws every located door", async () => await p.evaluate(() => {
    const c = document.querySelector("#nightmap");
    if(!c) return false;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const bg = d[0] + "," + d[1] + "," + d[2];
    let diff = 0;
    for(let i = 0; i < d.length; i += 4)
      if(d[i] + "," + d[i+1] + "," + d[i+2] !== bg) diff++;
    return diff > 3000;
  }));
  await t("the caption says the doors come from addresses", async () => {
    const cap = await p.locator(".mapwrap .cap").last().innerText();
    return /from addresses/.test(cap);
  });

  /* The whole point: Find works on night one, before a single delivery. */
  await t("Find points at an unvisited door using its address", async () => {
    await p.evaluate(() => {
      GEO.pos = { lat: 61.0, lon: 24.46 }; GEO.acc = 8; GEO.at = Date.now();
    });
    await p.click('[data-pane="find"]'); await p.waitForTimeout(500);
    const txt = await p.locator("#pane-find").innerText();
    return /\d/.test(await p.locator(".readout .dist").innerText())
        && /street address/.test(txt);
  });
  await t("looked-up doors reach the nearest-doors list", async () =>
    (await p.locator(".near").count()) > 0 &&
    /~/.test(await p.locator(".near .d").first().innerText()));
  await t("a real pin beats the looked-up address", async () => {
    await p.evaluate(() => {
      const r = DATA.routes[0], s = r.stops[0];
      recordFix(r.id + ":" + s.k, 61.0005, 24.4605, 5);
    });
    return await p.evaluate(() => {
      const r = DATA.routes[0], s = r.stops[0];
      return !doorPos(r, s).approx;
    });
  });

  /* Losing the connection mid-run must keep what it has and say so. */
  await t("a dead connection stops the run but keeps every saved door", async () => {
    await p.evaluate(() => { localStorage.removeItem("pp.addrpos.v1"); APOS = {}; });
    let n = 0;
    await p.unroute("https://nominatim.openstreetmap.org/**");
    await p.route("https://nominatim.openstreetmap.org/**", route => {
      if(++n > 10) return route.abort();
      const q = decodeURIComponent(new URL(route.request().url()).searchParams.get("q"));
      let h = 0; for(const ch of q) h = (h * 31 + ch.charCodeAt(0)) % 9973;
      return route.fulfill({ json: [{ lat: String(61.0 + (h % 89) / 8900),
                                      lon: String(24.46 + (h % 97) / 4850) }] });
    });
    await p.click('[data-pane="routes"]'); await p.waitForTimeout(250);
    await p.click("[data-lookup]");
    await p.waitForFunction(() => !LOOKUP.running &&
      Object.keys(JSON.parse(localStorage.getItem("pp.addrpos.v1") || "{}")).length === 10,
      null, { timeout: 15000 });
    await p.waitForTimeout(300);
    const kept = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("pp.addrpos.v1") || "{}")).length);
    const label = await p.locator("[data-lookup]").innerText();
    return kept === 10 && label.includes("10 of 134");
  });

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
