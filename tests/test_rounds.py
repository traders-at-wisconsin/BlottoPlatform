import pytest
from conftest import ARMIES, PLAYERS, doc, draw, in_hours, play_round, score

import repo
from errors import ConflictError, ValidationError


def submit(comp, armies):
    r = repo.open_round(comp.db, comp.cid, in_hours(1), seed=7)
    for uid, alloc in armies.items():
        repo.save_submission(comp.db, comp.cid, r, uid, alloc)
    return r


def test_close_draws_groups_from_submitters_and_eliminates_no_shows(comp):
    db, cid = comp.db, comp.cid
    armies = {u: a for u, a in ARMIES.items() if u != "u_fay"}
    r = submit(comp, armies)
    ids = repo.close_round(db, cid, r, draw())

    assert ids == ["A", "B"]  # 5 submitters is above the final threshold of 4
    rnd = repo.get_round(db, cid, r)
    groups = repo.get_groups(db, cid, r)
    assert sorted(u for g in groups.values() for u in g.members) == sorted(armies)
    assert (rnd.status, rnd.player_count, rnd.group_ids) == ("closed", 5, ids)
    fay = repo.get_player(db, cid, "u_fay")
    assert (fay.status, fay.round_eliminated) == ("eliminated", 1)


def test_more_than_threshold_gives_group_round(comp):
    r = submit(comp, ARMIES)
    assert repo.close_round(comp.db, comp.cid, r, draw()) == ["A", "B"]
    assert repo.get_round(comp.db, comp.cid, r).is_final is False


def test_close_rejects_a_draw_that_drops_a_player(comp):
    r = submit(comp, ARMIES)
    with pytest.raises(ValidationError):
        repo.close_round(comp.db, comp.cid, r, lambda uids, seed: [uids[:-1]])
    assert repo.get_round(comp.db, comp.cid, r).status == "open"


def test_close_needs_a_submission(comp):
    r = submit(comp, {})
    with pytest.raises(ConflictError):
        repo.close_round(comp.db, comp.cid, r, draw())


def test_scoring_needs_a_closed_round(comp):
    r = submit(comp, ARMIES)
    with pytest.raises(ConflictError, match="closed"):
        repo.write_scoring_output(comp.db, comp.cid, r, {}, {})


def test_scoring_writes_hidden_groups_and_results(comp):
    db, cid = comp.db, comp.cid
    r = submit(comp, ARMIES)
    repo.close_round(db, cid, r, draw())
    score(db, cid, r)

    assert repo.get_round(db, cid, r).status == "scored"
    for gid, group in repo.get_groups(db, cid, r).items():
        assert [row.rank for row in group.standings] == [1, 2, 3]
        assert group.advance_count == 2
        assert [row.advanced for row in group.standings] == [True, True, False]
        for row in group.standings:
            res = doc(db, f"competitions/{cid}/rounds/{r}/results/{row.uid}")
            assert (res["groupId"], res["rank"], res["allocation"]) == (gid, row.rank, ARMIES[row.uid])
            assert len(res["matches"]) == 2
            for m in res["matches"]:
                assert m["opponentAllocation"] == ARMIES[m["opponent"]]
                assert m["outcome"] in ("win", "tie", "loss")
    assert repo.get_player(db, cid, "u_ann").status == "active"  # nothing applied until publish


def test_rescoring_overwrites_identically(comp):
    db, cid = comp.db, comp.cid
    r = submit(comp, ARMIES)
    repo.close_round(db, cid, r, draw())
    score(db, cid, r)
    base = f"competitions/{cid}/rounds/{r}"
    first = {d.id: d.to_dict() for d in db.collection(f"{base}/results").stream()}
    score(db, cid, r)
    second = {d.id: d.to_dict() for d in db.collection(f"{base}/results").stream()}
    assert first == second and len(second) == len(PLAYERS)


def test_scoring_output_must_match_the_groups(comp):
    db, cid = comp.db, comp.cid
    r = submit(comp, ARMIES)
    repo.close_round(db, cid, r, draw())
    results = score(db, cid, r)
    adv = {g: [] for g in results}
    with pytest.raises(ValidationError):
        repo.write_scoring_output(db, cid, r, {"A": results["A"]}, adv)
    with pytest.raises(ValidationError):
        repo.write_scoring_output(db, cid, r, results, {**adv, "A": ["u_stranger"]})


def test_publish_needs_scoring(comp):
    r = submit(comp, ARMIES)
    with pytest.raises(ConflictError):
        repo.publish_round(comp.db, comp.cid, r)


def test_publish_applies_advancement_and_builds_the_leaderboard(comp):
    db, cid = comp.db, comp.cid
    r = play_round(db, cid, ARMIES)

    rnd = repo.get_round(db, cid, r)
    assert (rnd.status, rnd.seed) == ("published", 7)
    advanced = {row.uid for g in repo.get_groups(db, cid, r).values() for row in g.standings if row.advanced}
    for uid in PLAYERS:
        p = repo.get_player(db, cid, uid)
        assert p.furthest_round == 1
        assert p.status == ("active" if uid in advanced else "eliminated")
        assert p.round_eliminated == (None if uid in advanced else 1)

    board = doc(db, f"competitions/{cid}/leaderboard/current")
    assert board["round"] == 1 and len(board["entries"]) == len(PLAYERS)
    assert {e["uid"] for e in board["entries"][:4]} == advanced


def test_publish_twice_is_refused(comp):
    r = play_round(comp.db, comp.cid, ARMIES)
    with pytest.raises(ConflictError):
        repo.publish_round(comp.db, comp.cid, r)


def test_full_competition_crowns_a_champion(comp):
    db, cid = comp.db, comp.cid
    play_round(db, cid, ARMIES)
    finalists = {p.id: ARMIES[p.id] for p in repo.players_coll(db, cid).stream() if p.get("status") == "active"}
    r = play_round(db, cid, finalists)

    assert repo.get_round(db, cid, r).is_final
    comp_doc = repo.get_competition(db, cid)
    assert comp_doc.status == "completed"
    champ = repo.get_player(db, cid, comp_doc.champion_id)
    assert champ.status == "champion" and champ.furthest_round == 2
    others = [repo.get_player(db, cid, u) for u in finalists if u != comp_doc.champion_id]
    assert all(p.status == "eliminated" and p.round_eliminated == 2 for p in others)

    entries = doc(db, f"competitions/{cid}/leaderboard/current")["entries"]
    assert entries[0]["uid"] == comp_doc.champion_id and entries[0]["rank"] == 1
    assert [e["furthestRound"] for e in entries] == sorted((e["furthestRound"] for e in entries), reverse=True)
    with pytest.raises(ConflictError):
        repo.open_round(db, cid, in_hours(1))
