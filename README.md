# Katinen B — Night Run

An offline companion for the Posti early-morning round in Katinen B, Hämeenlinna
(routes 1096016–1096020, depot Lautatarhankatu 5).

The Pomo device has the delivery book but no map. This is the missing half: the
same stops in the same order, with one-tap navigation and a place to write down
what you learn at each door.

**`index.html` is the whole app.** One file, no build step, no server, no
network. Open it and it works.

## The one rule

Two kinds of information live in that delivery book, and they behave nothing
alike:

| | Changes | Source of truth |
|---|---|---|
| Stop order, the turns between stops, which archway, which stairwell, where the mailbox is bolted, which floor a flat is on, gate codes | Basically never — buildings don't move | **This app** |
| Which flats take which paper, and how many | **Every night** — Posti rebuilds it from live subscriptions; people pause for holidays, start, cancel | **The Pomo, always** |

Paper codes in this app are labelled **Usually** and stamped with the date they
were copied. They are a hint about which floors you normally climb, not an
instruction. **Where they disagree with the Pomo, the Pomo is right.**

If the Pomo lists nothing for an address tonight, tap *Pomo shows nothing here
tonight — skip*. The stop drops off the list and is counted separately, so a
light night doesn't flatter your times. Any door in a flat list can be ticked,
including greyed-out ones — tonight's list can name a flat that took nothing
when this was written down.

## Put it on your phone

1. Get the file onto the phone (message it to yourself, or open the published
   link).
2. **iPhone** — open it in Safari, then Share → *Add to Home Screen*.
   **Android** — Chrome menu → *Add to Home screen*.
3. It now opens full-screen and works with no signal. Only the *Navigate*
   buttons need a connection, and those hand off to Google Maps.

## What it does

- **Run** — the stops in book order. The current stop is expanded; the ones you
  have settled collapse out of the way. Each card shows how to drive there from
  the last stop, where the mailbox is, and the flat roster with floors. One big
  **Delivered** button under your thumb, and an undo next to it.
- **Pace** — projected finish against the length of the route's time window, so
  you can tell at stop 4 whether you are going to make it. Starting late doesn't
  make it panic.
- **Routes** — switch between the five routes, amber night-vision mode, and a
  brightness dimmer for 3am eyes.
- **Data** — add the rest of the delivery book yourself, and back it up.
- **Help** — how to get quick on a round you don't know, paper codes, and the
  Finnish words that appear on the Pomo and on doors.

Your ticks clear themselves when the date rolls over. **Your door notes and your
per-stop timings are permanent** — they are the point of the whole thing.

## What is actually in it

Route **1096016** is entered as far as the photos went: page **1 of 4**, six
stops, Lautatarhankatu 5 through Wähäjärvenkatu 3, from the **7 Aug 2026**
snapshot. Routes 1096017–1096020 are empty shells with their time windows.

The app is honest about this — under **Data** it shows how many papers that
snapshot's route total accounts for versus how many have an address, which is a
rough measure of how much book is still untyped. It is a transcription check,
not a count of anything you carry tonight.

Two gaps worth closing, both flagged in the app:

- **Wähäjärvenkatu 3** — the 2nd-floor flat rows were cut off in the photo. Six
  of the eight HASA are placed; two more are on that floor.
- **VKO** and **TCO** — paper codes I could not identify. Ask your supervisor.

## Adding the rest of the book

Sit down at home with the Pomo on **Preview** — not in the car at 01:00. Under
**Data**, add one stop per address in the same order the Pomo lists them.

Type in **the addresses, the turns and the mailbox notes**. Those are worth
typing once and keep paying out. Papers are optional and go stale by the next
night, so don't spend time on them.

Reading the Pomo's Preview screen: the highlighted box holds the **house number**
and the **at-the-door** instruction; the text *underneath* the box is the
instruction for driving to the **next** address. This app keeps those two apart,
which is why each stop shows you the leg to get there and the mailbox note
separately.

Papers go in as `HS 4, HASA 5, VKO 1`. Flats go in one line per floor:

```
1st floor: A3 -, A2 HS+HASA, A1 HASA
2nd floor: A8 HS+HASA, A7 -, A6 -, A5 HS, A4 -
```

A dash means that flat usually gets nothing. By default the app hides those, so
a building with 18 flats shows the 7 doors you normally climb to — but every
door stays tickable, because tonight's list is the Pomo's, not this one's.

## Backing it up

Everything lives in the browser's local storage on that one phone. Clearing site
data would wipe it. Once you have typed a route in, go to **Data → Backup**,
copy the text, and message it to yourself. Pasting it back restores the routes
and every note on any phone.

## Paper codes

| Code | Paper |
|------|-------|
| HS | Helsingin Sanomat |
| HASA | Hämeen Sanomat |
| MT | Maaseudun Tulevaisuus |
| VKO | unidentified — ask your supervisor |
| TCO | unidentified — ask your supervisor |
