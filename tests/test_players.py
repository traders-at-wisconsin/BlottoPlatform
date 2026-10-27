import pytest
from conftest import ARMIES, MINI, draw, in_hours

import repo
from errors import ConflictError, ForbiddenError, ValidationError


def test_join_requires_a_registered_email(db):
    cid = repo.create_competition(db, "Cup", MINI)
    with pytest.raises(ForbiddenError):
        repo.create_player(db, cid, "u1", "Ann", "stranger@wisc.edu")
    repo.add_registrations(db, ["Ann@Wisc.edu "])
    assert repo.create_player(db, cid, "u1", "Ann", "ann@wisc.edu").status == "active"


def test_join_is_idempotent_and_keeps_the_first_name(comp):
    again = repo.create_player(comp.db, comp.cid, "u_ann", "Someone else", "u_ann@wisc.edu")
    assert again.display_name == "Ann"


@pytest.mark.parametrize("name", ["", "   ", "x" * 41, None])
def test_display_name_is_validated(db, name):
    cid = repo.create_competition(db, "Cup", MINI)
    repo.add_registrations(db, ["a@wisc.edu"])
    with pytest.raises(ValidationError):
        repo.create_player(db, cid, "u1", name, "a@wisc.edu")


def test_joining_closes_with_round_one(comp):
    db, cid = comp.db, comp.cid
    repo.add_registrations(db, ["late@wisc.edu", "later@wisc.edu"])
    r = repo.open_round(db, cid, in_hours(1))
    repo.create_player(db, cid, "u_late", "Late", "late@wisc.edu")  # round 1 still open
    for uid, alloc in ARMIES.items():
        repo.save_submission(db, cid, r, uid, alloc)
    repo.close_round(db, cid, r, draw())
    with pytest.raises(ConflictError):
        repo.create_player(db, cid, "u_later", "Later", "later@wisc.edu")
    assert repo.get_player(db, cid, "u_late").status == "eliminated"  # joined but never submitted


def test_emails_are_validated(db):
    with pytest.raises(ValidationError):
        repo.add_registrations(db, ["not-an-email"])
