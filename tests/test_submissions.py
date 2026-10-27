from datetime import timedelta

import pytest
from conftest import ARMIES, draw, in_hours, play_round

import repo
from errors import ConflictError, NotFoundError, ValidationError


@pytest.fixture
def open_round(comp):
    comp.r = repo.open_round(comp.db, comp.cid, in_hours(1))
    return comp


def test_open_round_numbers_rounds_and_hides_the_seed(open_round):
    db, cid = open_round.db, open_round.cid
    rnd = repo.get_round(db, cid, 1)
    assert (open_round.r, rnd.status, rnd.seed) == (1, "open", None)
    assert isinstance(repo.round_secrets_ref(db, cid, 1).get().get("seed"), int)
    comp = repo.get_competition(db, cid)
    assert (comp.status, comp.current_round) == ("running", 1)


def test_next_round_waits_for_publish(open_round):
    with pytest.raises(ConflictError):
        repo.open_round(open_round.db, open_round.cid, in_hours(2))


def test_deadline_must_be_future_and_timezone_aware(comp):
    with pytest.raises(ValidationError):
        repo.open_round(comp.db, comp.cid, in_hours(-1))
    with pytest.raises(ValidationError):
        repo.open_round(comp.db, comp.cid, in_hours(1).replace(tzinfo=None))


def test_resubmitting_replaces_the_allocation(open_round):
    db, cid, r = open_round.db, open_round.cid, open_round.r
    repo.save_submission(db, cid, r, "u_ann", [3, 3, 4])
    repo.save_submission(db, cid, r, "u_ann", [10, 0, 0])
    assert repo.get_submissions(db, cid, r) == {"u_ann": [10, 0, 0]}


@pytest.mark.parametrize("alloc", [[3, 3], [3, 3, 3], [-1, 6, 5], [3.0, 3, 4], [True, 4, 5], "334", None])
def test_invalid_allocations_are_rejected(open_round, alloc):
    with pytest.raises(ValidationError):
        repo.save_submission(open_round.db, open_round.cid, open_round.r, "u_ann", alloc)


def test_late_submission_is_rejected(open_round):
    db, cid, r = open_round.db, open_round.cid, open_round.r
    repo.round_ref(db, cid, r).update({"deadline": in_hours(0) - timedelta(seconds=1)})
    with pytest.raises(ConflictError, match="deadline"):
        repo.save_submission(db, cid, r, "u_ann", [3, 3, 4])


def test_no_submissions_once_closed(open_round):
    db, cid, r = open_round.db, open_round.cid, open_round.r
    for uid, alloc in ARMIES.items():
        repo.save_submission(db, cid, r, uid, alloc)
    repo.close_round(db, cid, r, draw())
    with pytest.raises(ConflictError, match="not open"):
        repo.save_submission(db, cid, r, "u_ann", [3, 3, 4])


def test_unknown_player_or_round(open_round):
    with pytest.raises(NotFoundError):
        repo.save_submission(open_round.db, open_round.cid, open_round.r, "u_nobody", [3, 3, 4])
    with pytest.raises(NotFoundError):
        repo.save_submission(open_round.db, open_round.cid, 9, "u_ann", [3, 3, 4])


def test_eliminated_players_cannot_submit(comp):
    db, cid = comp.db, comp.cid
    play_round(db, cid, ARMIES)
    out = next(p.id for p in repo.players_coll(db, cid).stream() if p.get("status") == "eliminated")
    r = repo.open_round(db, cid, in_hours(1))
    with pytest.raises(ConflictError, match="active"):
        repo.save_submission(db, cid, r, out, [3, 3, 4])
