# Katinen B — Night Run

An offline companion for the Posti early-morning round in Katinen B, Hämeenlinna
(routes 1096016–1096020, depot Lautatarhankatu 5).

The Pomo device has the delivery book but no map. This is the missing half: the
same stops in the same order, with one-tap navigation, the flats that actually
take a paper, and a place to write down what you learn at each door.

**`index.html` is the whole app.** One file, no build step, no server, no
network. Open it and it works.

## Put it on your phone

1. Get the file onto the phone (message it to yourself, or open the published
   link).
2. **iPhone** — open it in Safari, then Share → *Add to Home Screen*.
   **Android** — Chrome menu → *Add to Home screen*.
3. It now opens full-screen and works with no signal. Only the *Navigate*
   buttons need a connection, and those hand off to Google Maps.

## What it does

- **Run** — the stops in book order. The current stop is expanded; the ones you
  have done collapse out of the way. Each card shows how to drive there from the
  last stop, where the mailbox is, which papers it takes, and which flats to
  climb to. One big **Delivered** button under your thumb, and an undo next to it.
- **Pace** — projected finish against the route's time window, so you can tell
  at stop 4 whether you are going to make it.
- **Papers left** — what should still be in the bag. Check it against the bundle
  before you drive off.
- **Routes** — switch between the five routes, amber night-vision mode, and a
  brightness dimmer for 3am eyes.
- **Data** — add the rest of the delivery book yourself, and back it up.
- **Help** — how to get quick on a round you don't know, paper codes, and the
  Finnish words that appear on the Pomo and on doors.

Your ticks clear themselves when the date rolls over. **Your door notes and your
per-stop timings are permanent** — they are the point of the whole thing.

## What is actually in it

Route **1096016** is entered as far as the photos went: page **1 of 4**, six
stops, Lautatarhankatu 5 through Wähäjärvenkatu 3. Routes 1096017–1096020 are
empty shells with their time windows.

The app is honest about this — it shows how many papers the Pomo says the route
carries versus how many the entered stops account for, so you can see exactly
how much book is still missing.

Two gaps worth closing, both flagged in the app:

- **Wähäjärvenkatu 3** — the 2nd-floor flat rows were cut off in the photo. Six
  of the eight HASA are placed; two more are on that floor.
- **VKO** and **TCO** — paper codes I could not identify. Ask your supervisor.

## Adding the rest of the book

Sit down at home with the Pomo on **Preview** — not in the car at 01:00. Under
**Data**, add one stop per address in the same order the Pomo lists them.

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

A dash means that flat gets nothing. By default the app hides those, so a
building with 18 flats shows you the 7 doors that matter.

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
