"""Seeds the Firestore emulator with a full simulated competition: 200 registered
players with random armies (a few no-shows each round), played through every
round to a champion with the stub engine and the HLD's default config.

    firebase emulators:exec --only firestore "functions/venv/bin/python scripts/seed.py"

or, with the emulators already running (`firebase emulators:start`):

    functions/venv/bin/python scripts/seed.py [--players 150] [--seed 1] [--leave-open]
"""

import argparse
import os
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "functions"))
sys.path.insert(0, str(ROOT / "scripts"))
os.environ.setdefault("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")

import repo  # noqa: E402
import stub_engine  # noqa: E402
from schema import GameConfig  # noqa: E402

NO_SHOW_RATE = 0.03


def play_round(db, cid, cfg, rng, leave_open=False):
    r = repo.open_round(db, cid, datetime.now(timezone.utc) + timedelta(days=2), seed=rng.randrange(2**53))
    active = [p.id for p in repo.players_coll(db, cid).stream() if p.get("status") == "active"]
    submitters = [uid for uid in active if rng.random() > NO_SHOW_RATE]
    with ThreadPoolExecutor(16) as pool:
        list(pool.map(lambda uid: repo.save_submission(
            db, cid, r, uid, stub_engine.random_allocation(random.Random(f"{uid}:{r}"), cfg)), submitters))
    if leave_open:
        print(f"round {r}: left open with {len(submitters)} of {len(active)} submitted")
        return r, None

    repo.close_round(db, cid, r, lambda uids, seed: stub_engine.draw_groups(uids, cfg, seed))
    rnd = repo.get_round(db, cid, r)
    seed = repo.round_secrets_ref(db, cid, r).get().get("seed")
    allocs = repo.get_submissions(db, cid, r)
    results, adv = {}, {}
    for gid, group in repo.get_groups(db, cid, r).items():
        results[gid] = stub_engine.run_group({u: allocs[u] for u in group.members}, cfg, seed)
        adv[gid] = stub_engine.advancers(results[gid], cfg, is_final=rnd.is_final)
    repo.write_scoring_output(db, cid, r, results, adv)
    champion = repo.publish_round(db, cid, r)
    sizes = ", ".join(f"{g} {len(results[g].standings)}" for g in sorted(results))
    print(f"round {r}: {len(submitters)} of {len(active)} submitted; groups {sizes}; "
          f"{sum(len(a) for a in adv.values())} advance")
    return r, champion


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--players", type=int, default=200)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--leave-open", action="store_true",
                        help="stop with round 2 open, to see a competition mid-flight")
    args = parser.parse_args()

    rng = random.Random(args.seed)
    db = repo.client()
    cfg = GameConfig()
    started = time.perf_counter()

    cid = repo.create_competition(db, "Sample Competition", cfg)
    uids = [f"player_{i:03d}" for i in range(1, args.players + 1)]
    repo.add_registrations(db, [f"{u}@wisc.edu" for u in uids])
    with ThreadPoolExecutor(16) as pool:
        list(pool.map(lambda u: repo.create_player(db, cid, u, u.replace("_", " ").title(), f"{u}@wisc.edu"),
                      uids))

    champion = None
    while champion is None:
        stop = args.leave_open and repo.get_competition(db, cid).current_round == 1
        _, champion = play_round(db, cid, cfg, rng, leave_open=stop)
        if stop:
            break

    board = repo.leaderboard_ref(db, cid).get().to_dict()
    print(f"competition {cid}: champion {champion}; leaderboard {len(board['entries'])} players "
          f"({time.perf_counter() - started:.1f}s)")


if __name__ == "__main__":
    main()
