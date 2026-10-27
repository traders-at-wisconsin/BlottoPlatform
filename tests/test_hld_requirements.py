"""Acceptance tests taken from the MVP High Level Design (BlottoPlatform README).

Each test quotes the requirement it checks. Unlike the unit tests, these use the
HLD's default config (100 soldiers, 10 battlefields, 4 groups, top 25%, final at 16)
and full-size fields.
"""

import random
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
import requests
from conftest import doc, in_hours
from test_security_rules import BASE, token

import repo
import stub_engine
from errors import ConflictError, ForbiddenError, ValidationError
from schema import GameConfig

HLD = GameConfig()


def setup(db, n):
    cid = repo.create_competition(db, "HLD Cup", HLD)
    uids = [f"p{i:03d}" for i in range(n)]
    repo.add_registrations(db, [f"{u}@wisc.edu" for u in uids])
    with ThreadPoolExecutor(16) as pool:
        list(pool.map(lambda u: repo.create_player(db, cid, u, u.upper(), f"{u}@wisc.edu"), uids))
    return cid, uids


def active(db, cid):
    return sorted(p.id for p in repo.players_coll(db, cid).stream() if p.get("status") == "active")


def run_round(db, cid, submitters, publish=True):
    r = repo.open_round(db, cid, in_hours(1))
    with ThreadPoolExecutor(16) as pool:
        list(pool.map(lambda u: repo.save_submission(
            db, cid, r, u, stub_engine.random_allocation(random.Random(f"{u}:{r}"), HLD)), submitters))
    repo.close_round(db, cid, r, lambda uids, seed: stub_engine.draw_groups(uids, HLD, seed))
    rnd = repo.get_round(db, cid, r)
    allocs = repo.get_submissions(db, cid, r)
    results, adv = {}, {}
    for gid, g in repo.get_groups(db, cid, r).items():
        results[gid] = stub_engine.run_group({u: allocs[u] for u in g.members}, HLD, seed=r)
        adv[gid] = stub_engine.advancers(results[gid], HLD, is_final=rnd.is_final)
    repo.write_scoring_output(db, cid, r, results, adv)
    if publish:
        repo.publish_round(db, cid, r)
    return r


def group_shape(db, cid, r):
    groups = repo.get_groups(db, cid, r)
    return sorted((len(g.members), g.advance_count) for g in groups.values())


def read(uid, path, admin=False):
    headers = {"Authorization": f"Bearer {token(uid, admin)}"} if uid else {}
    return requests.get(f"{BASE}/{path}", headers=headers).status_code


# --- Tournament shape -------------------------------------------------------

@pytest.mark.parametrize("n, rounds", [
    # "Round 1 | 4 groups of 50, top 13 each advance -> 52 | Round 2 | 4 groups of 13, top 4 each -> 16 |
    #  Final | 16 players, one round robin"
    (200, [[(50, 13)] * 4, [(13, 4)] * 4, [(16, 1)]]),
    # "2 groups of 38 and 2 of 37, top 10 each -> 40 | 4 groups of 10, top 3 each -> 12 | 12 players"
    (150, [[(37, 10), (37, 10), (38, 10), (38, 10)], [(10, 3)] * 4, [(12, 1)]]),
])
def test_tournament_table_from_the_hld(db, n, rounds):
    cid, _ = setup(db, n)
    for expected in rounds:
        r = run_round(db, cid, active(db, cid))
        assert group_shape(db, cid, r) == expected
    comp = repo.get_competition(db, cid)
    assert comp.status == "completed" and comp.current_round == 3
    assert repo.get_player(db, cid, comp.champion_id).status == "champion"
    assert len(active(db, cid)) == 0


def test_one_results_document_per_player_not_per_match(db):
    """"Round 1 writes about 200 documents instead of 4,900, and a results page is one read." """
    cid, uids = setup(db, 200)
    r = run_round(db, cid, uids, publish=False)
    results = list(repo.round_ref(db, cid, r).collection("results").stream())
    assert len(results) == 200
    assert all(len(d.get("matches")) == 49 for d in results)


# --- Elimination ------------------------------------------------------------

def test_no_submission_means_elimination_in_every_round(db):
    """"Anyone who has not submitted by the deadline is eliminated, in every round." """
    cid, uids = setup(db, 40)
    run_round(db, cid, uids[:-3])
    for u in uids[-3:]:
        p = repo.get_player(db, cid, u)
        assert (p.status, p.round_eliminated) == ("eliminated", 1)

    survivors = active(db, cid)
    no_show = survivors[0]
    r2 = run_round(db, cid, survivors[1:], publish=False)
    p = repo.get_player(db, cid, no_show)
    assert (p.status, p.round_eliminated) == ("eliminated", 2)
    assert no_show not in {u for g in repo.get_groups(db, cid, r2).values() for u in g.members}


def test_groups_are_drawn_from_submitters_only(db):
    """"Groups drawn at close, from submitters only. No empty seats." """
    cid, uids = setup(db, 30)
    r = run_round(db, cid, uids[::2], publish=False)
    members = [u for g in repo.get_groups(db, cid, r).values() for u in g.members]
    assert sorted(members) == sorted(uids[::2])


def test_publish_eliminates_everyone_outside_the_top_quarter(db):
    """"Published. ... players outside their group's top 25% are eliminated." """
    cid, uids = setup(db, 80)
    r = run_round(db, cid, uids)
    for g in repo.get_groups(db, cid, r).values():
        assert g.advance_count == -(-len(g.members) // 4)  # ceil(0.25 x size)
        for row in g.standings:
            assert repo.get_player(db, cid, row.uid).status == ("active" if row.advanced else "eliminated")
            assert row.advanced == (row.rank <= g.advance_count)


# --- Submitting -------------------------------------------------------------

def test_resubmit_until_the_deadline(db):
    """"Submitting and resubmitting an allocation until each round's deadline." """
    cid, uids = setup(db, 2)
    r = repo.open_round(db, cid, in_hours(1))
    for alloc in ([10] * 10, [100] + [0] * 9, [0] * 9 + [100]):
        repo.save_submission(db, cid, r, uids[0], alloc)
    assert repo.get_submissions(db, cid, r) == {uids[0]: [0] * 9 + [100]}


@pytest.mark.parametrize("alloc", [
    [10] * 9,  # 9 battlefields
    [10] * 9 + [11],  # 101 soldiers
    [10] * 9 + [9],  # 99 soldiers
    [20, -10] + [10] * 8,  # negative
    [10.5, 9.5] + [10] * 8,  # fractions
])
def test_allocation_is_whole_numbers_summing_to_exactly_100(db, alloc):
    """"Each player splits 100 soldiers across 10 battlefields as whole numbers summing to exactly 100." """
    cid, uids = setup(db, 1)
    r = repo.open_round(db, cid, in_hours(1))
    with pytest.raises(ValidationError):
        repo.save_submission(db, cid, r, uids[0], alloc)
    assert repo.get_submissions(db, cid, r) == {}


def test_submission_racing_the_close_is_cleanly_in_or_out(db):
    """"A submission racing the close is cleanly in or out." Every submitter that
    succeeded is in a group; every one that failed is not, and nobody is lost.
    """
    cid, uids = setup(db, 60)
    r = repo.open_round(db, cid, in_hours(1))
    for u in uids[:30]:
        repo.save_submission(db, cid, r, u, [10] * 10)

    accepted, start = set(uids[:30]), threading.Barrier(31)

    def late(u):
        start.wait()
        try:
            repo.save_submission(db, cid, r, u, [10] * 10)
            return u
        except ConflictError:
            return None

    with ThreadPoolExecutor(31) as pool:
        futures = [pool.submit(late, u) for u in uids[30:]]
        start.wait()
        repo.close_round(db, cid, r, lambda ids, seed: stub_engine.draw_groups(ids, HLD, seed))
        accepted |= {f.result() for f in futures} - {None}

    grouped = {u for g in repo.get_groups(db, cid, r).values() for u in g.members}
    assert grouped == accepted == set(repo.get_submissions(db, cid, r))
    for u in set(uids) - accepted:
        assert repo.get_player(db, cid, u).status == "eliminated"


# --- Sign-in ----------------------------------------------------------------

def test_only_allowlisted_emails_can_join(db):
    """"Email sign-in limited to registered players." """
    cid = repo.create_competition(db, "HLD Cup", HLD)
    with pytest.raises(ForbiddenError):
        repo.create_player(db, cid, "uid1", "Intruder", "intruder@gmail.com")


def test_one_registered_email_is_one_account(db):
    """"Email-link sign-in with an allowlist ... limits each registered person to one account." """
    cid = repo.create_competition(db, "HLD Cup", HLD)
    repo.add_registrations(db, ["ann@wisc.edu"])
    repo.create_player(db, cid, "uid1", "Ann", "ann@wisc.edu")
    with pytest.raises(ForbiddenError):
        repo.create_player(db, cid, "uid2", "Ann again", "ann@wisc.edu")


# --- Visibility -------------------------------------------------------------

def test_score_is_hidden_until_publish_then_everything_is_public(db):
    """"Scored. The engine has run and standings and results are written, but only admins can see them."
    "Published. Results, every allocation and the seed are revealed."
    """
    cid, uids = setup(db, 20)
    r = run_round(db, cid, uids, publish=False)
    me, other = uids[0], uids[1]
    rnd = f"competitions/{cid}/rounds/{r}"
    gid = doc(db, f"{rnd}/results/{me}")["groupId"]
    hidden = [f"{rnd}/results/{other}", f"{rnd}/groups/{gid}", f"{rnd}/submissions/{other}"]

    assert all(read(me, p) == 403 for p in hidden)
    assert all(read("org", p, admin=True) == 200 for p in hidden)
    assert doc(db, rnd)["seed"] is None

    repo.publish_round(db, cid, r)
    assert all(read(me, p) == 200 for p in hidden)
    assert all(read(None, p) == 403 for p in hidden)  # still needs sign-in
    seed = doc(db, rnd)["seed"]
    assert isinstance(seed, int) and seed == repo.round_secrets_ref(db, cid, r).get().get("seed")


def test_published_data_reproduces_every_result(db):
    """"Seed and every allocation public after each round; the deterministic engine reproduces any result." """
    cid, uids = setup(db, 24)
    r = run_round(db, cid, uids)
    allocs = {s.id: s.get("allocation") for s in repo.submissions_coll(db, cid, r).stream()}
    for g in repo.get_groups(db, cid, r).values():
        replay = stub_engine.run_group({u: allocs[u] for u in g.members}, HLD, seed=r)
        assert [s.player_id for s in replay.standings] == [row.uid for row in g.standings]


def test_no_client_writes_anywhere(db):
    """"Browsers never write: Security Rules deny every client write." """
    cid, uids = setup(db, 2)
    r = repo.open_round(db, cid, in_hours(1))
    me = uids[0]
    headers = {"Authorization": f"Bearer {token(me, admin=True)}"}
    body = {"fields": {"allocation": {"arrayValue": {"values": [{"integerValue": "100"}]}}}}
    for path in (f"competitions/{cid}/rounds/{r}/submissions/{me}",  # own submission
                 f"competitions/{cid}/players/{me}",
                 f"competitions/{cid}/leaderboard/current",
                 f"competitions/{cid}/rounds/{r}"):
        assert requests.patch(f"{BASE}/{path}", headers=headers, json=body).status_code == 403
    assert requests.delete(f"{BASE}/competitions/{cid}/players/{me}", headers=headers).status_code == 403
    assert requests.post(f"{BASE}/competitions/{cid}/players?documentId=evil",
                         headers=headers, json=body).status_code == 403


# --- Pages ------------------------------------------------------------------

def test_each_page_is_one_or_a_few_document_reads(db):
    """"Publishing writes each group's standings, every player's status and the single
    leaderboard document, so each page is one or a few document reads."
    """
    cid, uids = setup(db, 40)
    r = run_round(db, cid, uids)
    me = uids[0]
    base = f"competitions/{cid}"

    # Home: the round and my player document.
    comp = doc(db, base)
    assert doc(db, f"{base}/rounds/{comp['currentRound']}")["status"] == "published"
    assert doc(db, f"{base}/players/{me}")["status"] in ("active", "eliminated")

    # Results: my results document, then my group from the groupId it carries.
    mine = doc(db, f"{base}/rounds/{r}/results/{me}")
    group = doc(db, f"{base}/rounds/{r}/groups/{mine['groupId']}")
    assert len(mine["matches"]) == len(group["members"]) - 1
    assert all(len(m["opponentAllocation"]) == 10 for m in mine["matches"])  # battlefield by battlefield
    assert group["advanceCount"] and [row["rank"] for row in group["standings"]] == \
        list(range(1, len(group["members"]) + 1))

    # Leaderboard: "Every player, status, furthest round" in one document.
    entries = doc(db, f"{base}/leaderboard/current")["entries"]
    assert sorted(e["uid"] for e in entries) == sorted(uids)
    assert all({"status", "furthestRound", "displayName"} <= e.keys() for e in entries)


def test_rescoring_after_a_fix_fully_replaces_the_output(db):
    """"If something is wrong, the admin fixes it and re-scores, which safely overwrites the previous output." """
    cid, uids = setup(db, 20)
    r = run_round(db, cid, uids, publish=False)
    groups = repo.get_groups(db, cid, r)
    allocs = repo.get_submissions(db, cid, r)

    # The "fixed" engine run: reverse every group's ranking and advance different players.
    results, adv = {}, {}
    for gid, g in groups.items():
        res = stub_engine.run_group({u: allocs[u] for u in g.members}, HLD, seed=r)
        flipped = [s.__class__(**{**s.__dict__, "rank": len(res.standings) - s.rank + 1})
                   for s in reversed(res.standings)]
        results[gid] = stub_engine.GroupResult(flipped, res.matches)
        adv[gid] = [flipped[0].player_id]
    repo.write_scoring_output(db, cid, r, results, adv)

    for gid, g in repo.get_groups(db, cid, r).items():
        assert [row.uid for row in g.standings] == [s.player_id for s in results[gid].standings]
        assert [row.uid for row in g.standings if row.advanced] == adv[gid]
        for row in g.standings:
            res = doc(db, f"competitions/{cid}/rounds/{r}/results/{row.uid}")
            assert (res["rank"], res["advanced"]) == (row.rank, row.advanced)
    repo.publish_round(db, cid, r)
    assert sorted(active(db, cid)) == sorted(u for a in adv.values() for u in a)


def test_scoring_and_publishing_are_separate_steps(db):
    """"Score and publish are separate steps": publishing an unscored round, scoring
    a published round and re-publishing are all refused."""
    cid, uids = setup(db, 10)
    r = repo.open_round(db, cid, in_hours(1))
    for u in uids:
        repo.save_submission(db, cid, r, u, [10] * 10)
    repo.close_round(db, cid, r, lambda ids, seed: stub_engine.draw_groups(ids, HLD, seed))
    with pytest.raises(ConflictError):
        repo.publish_round(db, cid, r)
    repo.round_ref(db, cid, r).update({"status": "published"})
    with pytest.raises(ConflictError):
        repo.write_scoring_output(db, cid, r, {}, {})


def test_reimporting_the_allowlist_keeps_the_account_binding(db):
    cid = repo.create_competition(db, "HLD Cup", HLD)
    repo.add_registrations(db, ["ann@wisc.edu"])
    repo.create_player(db, cid, "uid1", "Ann", "ann@wisc.edu")
    repo.add_registrations(db, ["ann@wisc.edu"])
    with pytest.raises(ForbiddenError):
        repo.create_player(db, cid, "uid2", "Ann again", "ann@wisc.edu")
