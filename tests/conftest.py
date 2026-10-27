"""Shared fixtures. Tests run against the Firestore emulator, wiped before each test.

    firebase emulators:exec --only auth,firestore "functions/venv/bin/pytest"
"""

import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import requests

PROJECT_ID = "demo-blotto"
FIRESTORE_HOST = os.environ.setdefault("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")
os.environ.setdefault("GCLOUD_PROJECT", PROJECT_ID)

import repo  # noqa: E402
import stub_engine  # noqa: E402
from schema import GameConfig  # noqa: E402

# 3 battlefields / 10 soldiers. 6 players -> 2 groups of 3, top 2 each -> 4 -> final.
MINI = GameConfig(soldiers=10, battlefields=3, groups=2, advance_fraction=0.5, final_threshold=4)
PLAYERS = ["u_ann", "u_bob", "u_cat", "u_dan", "u_eve", "u_fay"]


@pytest.fixture(scope="session")
def db():
    try:
        requests.get(f"http://{FIRESTORE_HOST}/", timeout=2)
    except requests.ConnectionError:
        pytest.exit("Firestore emulator is not running. Run tests with:\n"
                    '  firebase emulators:exec --only auth,firestore "functions/venv/bin/pytest"',
                    returncode=2)
    return repo.client()


@pytest.fixture(autouse=True)
def clean_firestore(db):
    requests.delete(
        f"http://{FIRESTORE_HOST}/emulator/v1/projects/{PROJECT_ID}/databases/(default)/documents"
    ).raise_for_status()


def email(uid):
    return f"{uid}@wisc.edu"


def in_hours(h):
    return datetime.now(timezone.utc) + timedelta(hours=h)


@pytest.fixture
def comp(db):
    """A competition in registration with six joined players."""
    cid = repo.create_competition(db, "Test Cup", MINI, cid="test-cup")
    repo.add_registrations(db, [email(u) for u in PLAYERS])
    for u in PLAYERS:
        repo.create_player(db, cid, u, u.removeprefix("u_").title(), email(u))
    return SimpleNamespace(db=db, cid=cid)


def draw(cfg=MINI):
    return lambda uids, seed: stub_engine.draw_groups(uids, cfg, seed)


def score(db, cid, r, cfg=MINI):
    """What admin.scoreRound does: run the engine on every group and store the output."""
    rnd = repo.get_round(db, cid, r)
    allocs = repo.get_submissions(db, cid, r)
    results, adv = {}, {}
    for gid, group in repo.get_groups(db, cid, r).items():
        result = stub_engine.run_group({u: allocs[u] for u in group.members}, cfg, seed=r)
        results[gid] = result
        adv[gid] = stub_engine.advancers(result, cfg, is_final=rnd.is_final)
    repo.write_scoring_output(db, cid, r, results, adv)
    return results


def play_round(db, cid, allocs, cfg=MINI, publish=True):
    """Opens the next round, submits `allocs` (uid -> allocation), closes, scores and publishes."""
    r = repo.open_round(db, cid, in_hours(1), seed=7)
    for uid, alloc in allocs.items():
        repo.save_submission(db, cid, r, uid, alloc)
    repo.close_round(db, cid, r, draw(cfg))
    score(db, cid, r, cfg)
    if publish:
        repo.publish_round(db, cid, r)
    return r


def doc(db, path):
    return db.document(path).get().to_dict()


# Fixed armies for the six players.
ARMIES = {
    "u_ann": [4, 4, 2], "u_bob": [4, 3, 3], "u_cat": [5, 5, 0],
    "u_dan": [0, 6, 4], "u_eve": [1, 1, 8], "u_fay": [10, 0, 0],
}
