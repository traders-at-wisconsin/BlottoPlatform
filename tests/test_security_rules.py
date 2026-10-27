"""Firestore security rules, exercised through the emulator's REST API as ordinary
clients. The emulator accepts unsigned ID tokens, so each caller is a forged token.
"""

import base64
import json

import pytest
import requests
from conftest import ARMIES, FIRESTORE_HOST, PROJECT_ID, draw, in_hours, score

import repo

BASE = f"http://{FIRESTORE_HOST}/v1/projects/{PROJECT_ID}/databases/(default)/documents"


def _b64(obj):
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()


def token(uid, admin=False):
    claims = {"sub": uid, "user_id": uid, "aud": PROJECT_ID, "iat": 0, "exp": 2**31,
              "iss": f"https://securetoken.google.com/{PROJECT_ID}",
              "firebase": {"sign_in_provider": "custom"}}
    if admin:
        claims["admin"] = True
    return f"{_b64({'alg': 'none', 'typ': 'JWT'})}.{_b64(claims)}."


CALLERS = {
    "anon": None,
    "owner": token("u_ann"),
    "other": token("u_bob"),
    "admin": token("u_admin", admin=True),
}


def can_read(caller, path):
    headers = {"Authorization": f"Bearer {CALLERS[caller]}"} if CALLERS[caller] else {}
    status = requests.get(f"{BASE}/{path}", headers=headers).status_code
    assert status in (200, 403), status
    return status == 200


@pytest.fixture
def stages(comp):
    """Advances round 1 one step per call: open -> closed -> scored -> published."""
    db, cid = comp.db, comp.cid
    r = repo.open_round(db, cid, in_hours(1), seed=7)
    for uid, alloc in ARMIES.items():
        repo.save_submission(db, cid, r, uid, alloc)
    steps = iter([
        lambda: repo.close_round(db, cid, r, draw()),
        lambda: score(db, cid, r),
        lambda: repo.publish_round(db, cid, r),
    ])
    comp.next = lambda: next(steps)()
    comp.r = r
    return comp


def paths(c):
    rnd = f"competitions/{c.cid}/rounds/{c.r}"
    return {
        "own_submission": f"{rnd}/submissions/u_ann",
        "group": f"{rnd}/groups/A",
        "own_results": f"{rnd}/results/u_ann",
        "secrets": f"{rnd}/private/meta",
    }


def test_public_documents_need_sign_in(stages):
    cid = stages.cid
    for path in (f"competitions/{cid}", f"competitions/{cid}/players/u_bob", f"competitions/{cid}/rounds/1"):
        assert not can_read("anon", path)
        assert can_read("other", path)


def test_registrations_are_server_only(stages):
    assert not can_read("admin", "registrations/u_ann@wisc.edu")
    assert not can_read("owner", "registrations/u_ann@wisc.edu")


def test_before_publish_only_owner_and_admin_see_the_submission(stages):
    p = paths(stages)
    for step in range(3):  # open, closed, scored
        if step:
            stages.next()
        assert can_read("owner", p["own_submission"])
        assert not can_read("other", p["own_submission"])
        assert can_read("admin", p["own_submission"])
        assert not can_read("anon", p["own_submission"])


def test_groups_and_results_hidden_until_publish(stages):
    p = paths(stages)
    stages.next()
    stages.next()  # scored
    for doc in ("group", "own_results"):
        assert can_read("admin", p[doc])
        assert not can_read("owner", p[doc])
        assert not can_read("other", p[doc])


def test_everything_but_secrets_is_public_after_publish(stages):
    p = paths(stages)
    for _ in range(3):
        stages.next()
    for doc in ("own_submission", "group", "own_results"):
        assert can_read("other", p[doc])
        assert not can_read("anon", p[doc])
    assert can_read("other", f"competitions/{stages.cid}/leaderboard/current")
    assert not can_read("other", p["secrets"])
    assert can_read("admin", p["secrets"])


def test_seed_is_admin_only_before_publish(stages):
    p = paths(stages)
    assert not can_read("owner", p["secrets"])
    assert can_read("admin", p["secrets"])


def test_clients_cannot_write(stages):
    headers = {"Authorization": f"Bearer {CALLERS['admin']}"}
    for path in (f"competitions/{stages.cid}/players/u_ann",
                 f"competitions/{stages.cid}/rounds/1/submissions/u_ann",
                 "registrations/me@wisc.edu"):
        r = requests.patch(f"{BASE}/{path}", headers=headers,
                           json={"fields": {"status": {"stringValue": "champion"}}})
        assert r.status_code == 403
