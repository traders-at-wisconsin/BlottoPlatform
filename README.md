# Blotto Tournament — Organizer Guide

A live Colonel Blotto tournament for 150–200 players, run from phones in about an hour. Players join with their name, games last 90 seconds, results appear on a public leaderboard, and the field narrows to one champion.

| Who | Link |
| --- | --- |
| Players | **https://tradersatwisconsinblotto.web.app** |
| Projector / spectators (no sign-in) | https://tradersatwisconsinblotto.web.app/board |
| Organizers: sign in | https://tradersatwisconsinblotto.web.app/organizer |
| Organizers: console | https://tradersatwisconsinblotto.web.app/admin |

Contents: [Event-day checklist](#event-day-checklist) · [Rules](#rules) · [Format](#tournament-format) · [What players see](#what-players-see) · [Running the tournament](#running-the-tournament) · [Troubleshooting](#troubleshooting) · [Fairness and security](#fairness-and-security) · [Firebase setup and deploying](#firebase-setup-and-deploying) · [Development](#development) · [Known limitations](#known-limitations)

---

## Event-day checklist

**The day before**
- [ ] The Firebase project is on the **Blaze** plan, with a budget alert. The free plan allows only 100 simultaneous database connections, so player 101 onwards can't connect.
- [ ] Authentication → Sign-in method: **Anonymous**, **Google** and **Email/Password** are enabled.
- [ ] Every organizer can sign in at `/organizer` and reach `/admin` (see [Organizer access](#organizer-access)).
- [ ] A QR code points to the player link.
- [ ] Optional: run one stage with a few friends, then hard reset.

**Before doors open**
- [ ] `/admin` → **Hard reset** → also clear the player list. This wipes any test data.
- [ ] Host laptop: plugged in, sleep turned off, `/admin` open in a browser tab the whole time. **This tab does the scoring.**
- [ ] A backup organizer has `/admin` open on a second device.
- [ ] The projector shows `/board`.

**Announce to players**
- Join at the link or QR code. Use **one device** and **don't clear your browser** until the tournament ends.
- Each game is 90 seconds. You can edit until time runs out. If you don't submit, your entry is filled in for you.

---

## Rules

### Each game
- Split **100 soldiers** across **10 hills**, using whole numbers that add up to exactly 100.
- You play **everyone in your group** at once. Against each opponent:
  - Whoever puts more soldiers on a hill wins that hill. Equal numbers mean nobody wins it.
  - Win more hills than your opponent to win the match: **1 point**. A tie is **½ point**, a loss 0.
- **90 seconds** per game. Players can submit, edit and resubmit until the timer hits zero. The last submission counts.
- **Not submitting:** whatever the player typed is saved as they type. At the deadline, filled hills are kept and the rest of the 100 soldiers are split evenly across the hills left **blank**. Leftovers go to the lowest-numbered blank hills. A hill set to 0 counts as filled. A player who typed nothing gets 10 on every hill. A draft over 100 can't be used, so it becomes 10 on every hill.
  - If a player submitted and then edited without pressing **Update**, the earlier submission counts.
  - Auto-filled entries are labelled **Auto-filled** on that player's results.
- After every game, **every allocation is revealed**, so players can study the field.

### Group stages (3 games each)
- Each group stage is **3 games**, and match points add up across all 3.
- Ranking within a group:
  1. Match points
  2. Total hills won (all matches in the stage)
  3. Head to head: points from matches among only the tied players
  4. A seeded random draw. The seed is stored, so the result can be reproduced.
- The **top N in each group advance** (see the format table). Advancing rows are shaded, with a line at the cut.

### Final four: weighted hills, head to head
- The last 4 play **head to head, best of 3**: seed 1 v 4 and 2 v 3, then the winners play the Championship.
- **Weighted Blotto:** hill N is worth N points (hill 1 = 1, hill 10 = 10, 55 total). Win the game by taking **more points**, not more hills.
- First to 2 game wins advances. **A tied game doesn't count and is replayed**, so a match can run longer than 3 games.
- Finalists automatically see a **"Final four: new rules"** popup before these rounds.

---

## Tournament format

The format is **chosen automatically from the number of registered players** when you press start. There are no settings to change. Each stage's size is based on how many players are left.

| Players left | Next stage |
| --- | --- |
| 64 or more | 4 groups, top 12 per group advance (→ 48) |
| 32–63 | 2 groups, top 8 per group advance (→ 16) |
| 17–31 | 1 group, top 16 advance |
| 5–16 | **Semifinal**: 1 group, top 4 advance |
| 4 | **Finals**: 2 head-to-head matches, weighted, best of 3 |
| 3 | Playoff: 1 group, top 2 advance |
| 2 | **Championship**: head to head, weighted, best of 3 |
| 1 | Champion |

Typical runs:

| Turnout | Stages |
| --- | --- |
| 200 | Round 1 (4×50) → Round 2 (2×24) → Semifinal (16) → Finals (4) → Championship |
| 150 | Round 1 (4×37–38) → Round 2 (2×24) → Semifinal (16) → Finals (4) → Championship |
| 40 | Round 1 (2×20) → Semifinal (16) → Finals → Championship |

Groups are drawn by a seeded shuffle, and their sizes differ by at most 1. **Timing:** each game is about 2.5–3 minutes including results. 150–200 players means about 13–15 games, roughly **45–60 minutes**, plus any replayed bracket ties.

---

## What players see

1. **Join:** first name, last name and a **@wisc.edu email**, or **Continue with Google** (any Google account; name pre-filled). No passwords. **One player per email.** The name is public; the email is visible only to organizers.
2. **Waiting room:** the how-to-play popup opens automatically the first time, and **How to play** reopens it. It also shows the player count and rotating strategy one-liners.
3. **During a game:** a 10-hill form with a live total and the countdown timer. Blank hills show greyed numbers of what auto-fill would give. The timer pulses red in the last 10 seconds, and the form locks at zero.
4. **After a game** (until the organizer starts the next one):
   - Group stages show the record for that game (W/T/L, hills won, rank), plus a **hill-by-hill chart**: soldiers placed, the share of opponents beaten (green, up) and lost to (red, down), the best and worst hill, and the field average. Below that are the group's running standings.
   - Head-to-head stages show a **hill-by-hill comparison** of both players for every game, colored win/loss/tie.
5. **Outcomes:** "You advanced to …", "You advanced!", "Knocked out" or "You've been eliminated", with a link to the board. The champion screen comes at the end.

**Public board (`/board`):** stage name, game number, a large countdown, live "x / y submitted", the field average per hill after each game, every group's standings or every bracket match, and the champion banner. During registration it lists everyone who has joined.

---

## Running the tournament

### Organizer access
- Organizers sign in at **`/organizer`** with email/password or Google, then go to `/admin`.
- To make someone an organizer: they sign in once, then in the Firebase console → **Authentication → Users**, copy their **User UID**. In **Realtime Database → Data**, add `admins/<uid>` = `true` (boolean). It must be a map of uid → `true`; the old list format isn't recognized.
- Organizers aren't registered as players automatically. Use **Join as a player** on the home page if you want to play.

### Step by step
1. **Registration:** `/admin` shows the live player count, names and emails. **Remove** duplicates or joke names. Removing someone also frees their email so they can re-join, which is how you handle a player who switched devices.
2. **Start:** the admin page shows the projected format for the current count. Press **Lock registration and start**. Registration closes permanently, and Round 1 groups are drawn.
3. **Each game:** press **Start game N (90s)**. Watch the live submitted count, per group. **End now** stops the game early; whatever isn't submitted is auto-filled. About 3 seconds after time runs out, **the game scores itself** and every screen switches to results. Talk through the board, then start the next game.
4. **Between stages:** after the 3rd game, the bracket winners are decided, and the admin page lists who advances in seed order and previews the rest of the format. Press **Start Round 2**, **Start Semifinal**, **Start Finals** and so on.
5. **Finish:** press **Crown [name] champion**.

### Hard reset
**Hard reset** clears all stages, games, submissions and results. You can also clear the player list (registrations and emails). Admin accounts are kept. Use it before the event, or to restart a tournament that went wrong. **It can't be undone.**

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Player sees "Sign-up is not enabled yet" | Enable **Anonymous** sign-in in Firebase Authentication. |
| "That email is already registered" | The player probably switched devices or browsers. Remove their old entry on `/admin` (only possible during registration) and they re-join. |
| Player lost their session after registration locked | They can't re-enter as the same player. Their entries are auto-filled each game (10 per hill) until they're eliminated. Warn players up front to stay on one device. |
| Game stuck on "Time's up / Scoring…" | Scoring needs `/admin` open on some device. Open it, and it scores within a few seconds. If a game is stuck in "Scoring…" for 15+ seconds, press **Retry scoring**. |
| Host laptop died mid-game | Open `/admin` on any organizer device. The game state is in the database, so nothing is lost. |
| Players can't connect once more than about 100 have joined | The project is on the free Spark plan. Upgrade to Blaze. |
| Google sign-in fails | Check that Google is enabled and that the site's domain is listed under Authentication → Settings → Authorized domains (`tradersatwisconsinblotto.web.app` is listed by default). Preview-channel URLs may not be listed. |
| Bracket keeps going | Tied games are replayed until someone has 2 wins. Each one is another 90-second game. |
| Something is badly wrong | Hard reset and restart, or run the remaining games by hand. The admin can read every allocation in the database. |

---

## Fairness and security

The Realtime Database security rules (`database.rules.json`) enforce these on the server, not just in the browser:

- **Allocations stay private while a game is open.** Players can read and write only their own entry. Every allocation becomes public when the game is scored.
- **The deadline is enforced by server time.** Writes are rejected 1.5 seconds after the deadline and as soon as scoring starts. Phone clocks don't matter.
- **Only valid allocations are accepted:** exactly 10 whole numbers from 0 to 100 that sum to exactly 100.
- **Only players in the current game can submit.** Eliminated players and players whose match is decided can't.
- **One player per email.** Emails must be @wisc.edu, unless the player signs in with Google, in which case it must be their own Google email. Joining is closed once registration locks.
- **Only admins** can start or end games, write results, change stages or reset.
- **Results are reproducible.** Scoring is deterministic, and the tiebreak seed is stored, so anyone can recompute every result from the published allocations.

Scoring runs in an organizer's browser, so the rules trust admins completely. Give admin access to only a few people.

---

## Firebase setup and deploying

- Project: **tradersatwisconsinblotto**. It uses Realtime Database, Authentication and Hosting; there are no Cloud Functions.
- **Pushing to GitHub does not deploy.** To deploy from this branch:

```sh
npm install
npx firebase login          # once; use the account that owns the project
npm run build
npx firebase deploy --only database,hosting --project tradersatwisconsinblotto
```

- For a code-only change, `--only hosting` is enough. Deploy `database` whenever `database.rules.json` changes.
- To try a build without touching the live site, deploy to a temporary preview URL. It uses the live database.

```sh
npm run build && npx firebase hosting:channel:deploy preview --expires 7d --project tradersatwisconsinblotto
```

---

## Development

```sh
npm install
npm test                    # unit tests: scoring, auto-fill, ranking, bracket, weighted hills, format scaling
npm run dryrun              # full tournament with 150 bots in the local emulators (BOTS=200 npm run dryrun)
```

`npm run dryrun` drives the real admin code through every stage to a champion, while bots submit, resubmit, leave drafts or do nothing. It also checks the security rules and every auto-fill. It takes about 30 seconds, because games are ended early.

**Rehearse with the real UI and 90-second timers**, in three terminals:

```sh
npm run emulators           # local Auth + Realtime Database (UI at http://127.0.0.1:4000)
npm run dev:emulator        # the app, pointed at the emulators
BOTS=150 npm run bots       # bots join, then play every game you start from /admin
```

Sign up in the app, then make yourself admin in the emulator UI (`admins/<your uid>` = `true`).

### Code map

| Path | What it is |
| --- | --- |
| `src/lib/tournament.ts` | Pure game logic: validation, auto-fill, matches, weighted hills, ranking and tiebreaks, bracket, format scaling, post-game stats |
| `src/lib/tournamentDb.ts` | All database writes: registration, stages, games, scoring, reset |
| `src/hooks/useTournament.ts` | Live read model shared by players, admin and board |
| `src/pages/` | `HomePage` (player), `AdminPage`, `BoardPage`, `JoinPage`, `AuthPage` (organizer sign-in) |
| `database.rules.json` | Security rules: the enforcement layer |
| `scripts/dryrun.ts` | Emulator dry run and rehearsal bots |
| `tests/` | Unit tests (`node --test`) |
| `docs/HLD.md` | Original design document (historical) |

### Data model (Realtime Database)

| Path | Holds | Who reads / writes |
| --- | --- | --- |
| `admins/{uid}` | `true` | Signed-in users read; set in the console |
| `tournament` | `status` (registration / running / complete), current stage and game, champion | Public / admin |
| `players/{uid}` | Public name | Public / owner during registration |
| `registrations/{uid}`, `emails/{email}` | Private name and email, one-per-email index | Owner + admin |
| `stages/{id}` | Name, kind (groups / bracket), scoring (classic / weighted), groups, advance count, seed | Public / admin |
| `games/{id}` | Stage, number, status (open / scoring / scored), deadline, participants, submitted flags | Public / admin; players set their own submitted flag |
| `submissions/{game}/{uid}` | Final allocation | Owner + admin, while the game is open |
| `drafts/{game}/{uid}` | In-progress hills, used for auto-fill | Owner + admin, while the game is open |
| `results/{game}/{uid}` | Final allocation + auto-filled flag | Public / admin |

Old MVP keys (`rounds`, `groupingSets`, `roundActive`, `activeGroupingSet`) may still exist in the database. They're unused and nobody can read them.

---

## Known limitations

- **Emails aren't verified.** Someone could type a classmate's address, but each address can be used only once.
- **Sessions live in the browser.** A player who clears their browser or switches devices after registration locks can't get back in as the same player.
- **An organizer's `/admin` tab must be open for games to score.**
- **No late joining.** Once registration locks, it's closed.
- **No undo** for a scored game or a started stage. Hard reset is the only way back.
