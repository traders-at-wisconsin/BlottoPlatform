"""Data access for the Blotto competition: the only module that knows document paths.

The backend's callables (joinCompetition, submitAllocation, admin.*) call these
functions; nothing else touches Firestore. Each function checks the state it
depends on and raises an error from errors.py instead of writing bad data.

Round lifecycle, one function per admin step:

    open_round -> save_submission (players, until the deadline) -> close_round
    -> write_scoring_output (re-runnable) -> publish_round

Times come from the server clock (datetime.now in the function), never the client.
"""

import os
import re
import secrets
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime, timezone

from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore
from google.cloud.firestore import FieldFilter

from engine_types import GroupResult
from errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from leaderboard import build_leaderboard
from schema import (
    Competition,
    CompetitionStatus,
    GameConfig,
    Group,
    LastResult,
    MatchSummary,
    Outcome,
    Player,
    PlayerResults,
    PlayerStatus,
    Round,
    RoundSecrets,
    RoundStatus,
    StandingRow,
    Submission,
)

_BATCH_LIMIT = 500  # Firestore's cap on writes per commit
_MAX_NAME = 40
_EMAIL = re.compile(r"^[^@\s/]+@[^@\s/]+\.[^@\s/]+$")


def client():
    """A Firestore client. Against the emulator the plain client connects anonymously;
    the Admin SDK would insist on Google credentials.
    """
    if os.environ.get("FIRESTORE_EMULATOR_HOST"):
        return firestore.Client(project=os.environ.get("GCLOUD_PROJECT", "demo-blotto"))
    import firebase_admin
    from firebase_admin import firestore as admin_firestore
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    return admin_firestore.client()


def now():
    return datetime.now(timezone.utc)


def group_label(n):
    """1 -> A, 2 -> B, ... 27 -> G27."""
    return chr(64 + n) if 1 <= n <= 26 else f"G{n}"


# --- paths ------------------------------------------------------------------

def normalize_email(email):
    if not isinstance(email, str) or not _EMAIL.match(email.strip()):
        raise ValidationError(f"not a valid email: {email!r}")
    return email.strip().lower()


def registration_ref(db, email):
    return db.collection("registrations").document(normalize_email(email))


def competition_ref(db, cid):
    return db.collection("competitions").document(cid)


def players_coll(db, cid):
    return competition_ref(db, cid).collection("players")


def player_ref(db, cid, uid):
    return players_coll(db, cid).document(uid)


def leaderboard_ref(db, cid):
    return competition_ref(db, cid).collection("leaderboard").document("current")


def round_ref(db, cid, r):
    return competition_ref(db, cid).collection("rounds").document(str(r))


def round_secrets_ref(db, cid, r):
    return round_ref(db, cid, r).collection("private").document("meta")


def submissions_coll(db, cid, r):
    return round_ref(db, cid, r).collection("submissions")


def submission_ref(db, cid, r, uid):
    return submissions_coll(db, cid, r).document(uid)


def groups_coll(db, cid, r):
    return round_ref(db, cid, r).collection("groups")


def group_ref(db, cid, r, gid):
    return groups_coll(db, cid, r).document(gid)


def results_ref(db, cid, r, uid):
    return round_ref(db, cid, r).collection("results").document(uid)


# --- helpers ----------------------------------------------------------------

def _get(ref, model, what, transaction=None):
    snap = ref.get(transaction=transaction)
    if not snap.exists:
        raise NotFoundError(f"{what} not found")
    return model.from_doc(snap.to_dict())


def _commit(db, writes, last=()):
    """Applies [(op, ref, data, option)] writes. Everything goes in one atomic batch
    when it fits; otherwise `writes` go in chunks and `last` (the status change
    that makes them visible) goes in a final batch on its own.
    """
    def apply(batch, op, ref, data, option):
        if op == "set":
            batch.set(ref, data)
        elif op == "merge":
            batch.set(ref, data, merge=True)
        elif option is not None:
            batch.update(ref, data, option=option)
        else:
            batch.update(ref, data)

    writes, last = list(writes), list(last)
    if len(writes) + len(last) <= _BATCH_LIMIT:
        chunks = [writes + last]
    else:
        chunks = [writes[i:i + _BATCH_LIMIT] for i in range(0, len(writes), _BATCH_LIMIT)] + [last]
    for chunk in chunks:
        if chunk:
            batch = db.batch()
            for w in chunk:
                apply(batch, *w)
            batch.commit()


def _round_snapshot(db, cid, r, transaction=None):
    snap = round_ref(db, cid, r).get(transaction=transaction)
    if not snap.exists:
        raise NotFoundError(f"round {r} not found")
    return snap, Round.from_doc(snap.to_dict())


def _display_names(db, cid, uids):
    snaps = db.get_all([player_ref(db, cid, uid) for uid in uids])
    return {s.id: s.get("displayName") for s in snaps if s.exists}


def validate_allocation(allocation, config: GameConfig):
    if not isinstance(allocation, list) or len(allocation) != config.battlefields:
        raise ValidationError(f"allocation must have exactly {config.battlefields} battlefields")
    if not all(isinstance(a, int) and not isinstance(a, bool) and a >= 0 for a in allocation):
        raise ValidationError("soldier counts must be whole numbers, 0 or more")
    if sum(allocation) != config.soldiers:
        raise ValidationError(f"allocation must total {config.soldiers} soldiers, got {sum(allocation)}")


# --- setup (admin scripts) --------------------------------------------------

def add_registrations(db, emails):
    """Adds emails to the allowlist. Re-adding an email is harmless and keeps the
    account it is bound to. Returns the count.
    """
    at = now()
    writes = [("merge", registration_ref(db, e), {"email": normalize_email(e), "createdAt": at}, None)
              for e in emails]
    for i in range(0, len(writes), _BATCH_LIMIT):
        _commit(db, writes[i:i + _BATCH_LIMIT])
    return len(writes)


def is_registered(db, email):
    return registration_ref(db, email).get().exists


def create_competition(db, name, config=None, cid=None):
    """Creates a competition in `registration`. Returns its ID."""
    cfg = config if isinstance(config, GameConfig) else GameConfig.model_validate(config or {})
    coll = db.collection("competitions")
    ref = coll.document(cid) if cid else coll.document()
    comp = Competition(name=name, config=cfg, status=CompetitionStatus.REGISTRATION, created_at=now())
    try:
        ref.create(comp.to_doc())
    except AlreadyExists:
        raise ConflictError(f"competition {ref.id} already exists") from None
    return ref.id


def get_competition(db, cid):
    return _get(competition_ref(db, cid), Competition, f"competition {cid}")


def get_round(db, cid, r):
    return _get(round_ref(db, cid, r), Round, f"round {r}")


# --- players ----------------------------------------------------------------

def create_player(db, cid, uid, display_name, email):
    """Joins a registered email to the competition (joinCompetition).

    Calling it again for a player who already joined returns their document
    unchanged. Each registered email joins as one account: the first uid to use
    it is bound to the registration. Joining closes when round 1 closes.
    """
    name = display_name.strip() if isinstance(display_name, str) else ""
    if not name or len(name) > _MAX_NAME:
        raise ValidationError(f"display name must be 1-{_MAX_NAME} characters")
    c_ref, p_ref, reg_ref = competition_ref(db, cid), player_ref(db, cid, uid), registration_ref(db, email)

    @firestore.transactional
    def txn(tx):
        comp = _get(c_ref, Competition, f"competition {cid}", tx)
        existing = p_ref.get(transaction=tx)
        if existing.exists:
            return Player.from_doc(existing.to_dict())
        reg = reg_ref.get(transaction=tx)
        if not reg.exists:
            raise ForbiddenError("this email is not registered for the competition")
        if reg.to_dict().get("uid") not in (None, uid):
            raise ForbiddenError("this email is already linked to another account")
        if comp.status == CompetitionStatus.COMPLETED or comp.current_round > 1:
            raise ConflictError("the competition is no longer taking new players")
        if comp.current_round == 1:
            if _get(round_ref(db, cid, 1), Round, "round 1", tx).status != RoundStatus.OPEN:
                raise ConflictError("the competition is no longer taking new players")
        player = Player(display_name=name, status=PlayerStatus.ACTIVE, joined_at=now())
        tx.create(p_ref, player.to_doc())
        tx.update(reg_ref, {"uid": uid})
        return player

    return txn(db.transaction())


def get_player(db, cid, uid):
    return _get(player_ref(db, cid, uid), Player, f"player {uid}")


# --- rounds -----------------------------------------------------------------

def open_round(db, cid, deadline, seed=None):
    """Opens the next round (admin.openRound). The previous round must be published.

    The seed stays in rounds/{r}/private/meta (admins only) until publish, so
    nobody can predict the group draw. Returns the round number.
    """
    if not isinstance(deadline, datetime) or deadline.tzinfo is None:
        raise ValidationError("deadline must be a timezone-aware datetime")
    if deadline <= now():
        raise ValidationError("deadline must be in the future")
    seed = secrets.randbits(53) if seed is None else seed  # 53 bits: exact as a JS number
    c_ref = competition_ref(db, cid)

    @firestore.transactional
    def txn(tx):
        comp = _get(c_ref, Competition, f"competition {cid}", tx)
        if comp.status == CompetitionStatus.COMPLETED:
            raise ConflictError("the competition is over")
        r = comp.current_round + 1
        if comp.current_round:
            prev = _get(round_ref(db, cid, comp.current_round), Round, f"round {comp.current_round}", tx)
            if prev.status != RoundStatus.PUBLISHED:
                raise ConflictError(f"round {comp.current_round} has not been published")
        rnd = Round(number=r, status=RoundStatus.OPEN, deadline=deadline, opened_at=now())
        tx.create(round_ref(db, cid, r), rnd.to_doc())
        tx.create(round_secrets_ref(db, cid, r), RoundSecrets(seed=seed).to_doc())
        tx.update(c_ref, {"currentRound": r, "status": CompetitionStatus.RUNNING.value})
        return r

    return txn(db.transaction())


def save_submission(db, cid, r, uid, allocation):
    """Saves or replaces a player's allocation (submitAllocation).

    Round status, deadline and player status are checked inside the same
    transaction as the write, so a submission racing close is cleanly in or out.
    """
    @firestore.transactional
    def txn(tx):
        comp = _get(competition_ref(db, cid), Competition, f"competition {cid}", tx)
        rnd = _get(round_ref(db, cid, r), Round, f"round {r}", tx)
        player = _get(player_ref(db, cid, uid), Player, f"player {uid}", tx)
        validate_allocation(allocation, comp.config)
        if rnd.status != RoundStatus.OPEN:
            raise ConflictError(f"round {r} is not open")
        at = now()
        if at >= rnd.deadline:
            raise ConflictError(f"the deadline for round {r} has passed")
        if player.status != PlayerStatus.ACTIVE:
            raise ConflictError("only active players can submit")
        sub = Submission(uid=uid, allocation=allocation, submitted_at=at)
        tx.set(submission_ref(db, cid, r, uid), sub.to_doc())
        return sub

    return txn(db.transaction())


def get_submissions(db, cid, r):
    """uid -> allocation for every submission in the round (for scoring)."""
    return {s.id: s.get("allocation") for s in submissions_coll(db, cid, r).stream()}


def close_round(db, cid, r, draw_groups: Callable[[list[str], int], list[list[str]]]):
    """Freezes submissions, eliminates active players who did not submit and stores
    the groups (admin.closeRound).

    draw_groups(sorted_submitter_uids, seed) comes from the engine, e.g.
    `lambda uids, seed: blotto_engine.draw_groups(uids, cfg, seed)`. It must be
    deterministic, since the transaction may retry. One group means the final.
    Returns the group IDs.
    """
    @firestore.transactional
    def txn(tx):
        rnd = _get(round_ref(db, cid, r), Round, f"round {r}", tx)
        if rnd.status != RoundStatus.OPEN:
            raise ConflictError(f"round {r} is not open")
        seed = _get(round_secrets_ref(db, cid, r), RoundSecrets, f"round {r} secrets", tx).seed
        submitters = sorted(s.id for s in tx.get(submissions_coll(db, cid, r).select(["uid"])))
        active = [s.id for s in tx.get(players_coll(db, cid).where(
            filter=FieldFilter("status", "==", PlayerStatus.ACTIVE.value)))]
        if not submitters:
            raise ConflictError(f"nobody submitted in round {r}")

        groups = draw_groups(list(submitters), seed)
        drawn = [uid for g in groups for uid in g]
        if not groups or sorted(drawn) != submitters:
            raise ValidationError("the draw must place every submitter in exactly one group")

        ids = [group_label(i + 1) for i in range(len(groups))]
        for gid, members in zip(ids, groups):
            tx.set(group_ref(db, cid, r, gid), Group(id=gid, round=r, members=list(members)).to_doc())
        for uid in set(active) - set(submitters):
            tx.update(player_ref(db, cid, uid), {"status": PlayerStatus.ELIMINATED.value, "roundEliminated": r})
        tx.update(round_ref(db, cid, r), {
            "status": RoundStatus.CLOSED.value,
            "closedAt": now(),
            "groupIds": ids,
            "isFinal": len(groups) == 1,
            "playerCount": len(submitters),
        })
        return ids

    return txn(db.transaction())


def get_groups(db, cid, r):
    """group ID -> Group for the round."""
    return {s.id: Group.from_doc(s.to_dict()) for s in groups_coll(db, cid, r).stream()}


def _outcome(match, uid):
    if match.winner is None:
        return Outcome.TIE
    return Outcome.WIN if match.winner == uid else Outcome.LOSS


def write_scoring_output(db, cid, r, results: Mapping[str, GroupResult], advancers: Mapping[str, Sequence[str]]):
    """Stores the engine's output for every group, still hidden (admin.scoreRound).

    results and advancers are keyed by group ID (from close_round). Writes
    groups/{g} with ranked standings and results/{uid} for every player, then
    sets the round to `scored`. Re-running overwrites the same documents, so a
    fixed re-score replaces the previous one.
    """
    snap, rnd = _round_snapshot(db, cid, r)
    if rnd.status not in (RoundStatus.CLOSED, RoundStatus.SCORED):
        raise ConflictError(f"round {r} must be closed before scoring (it is {rnd.status})")
    groups = get_groups(db, cid, r)
    if set(results) != set(groups) or set(advancers) != set(groups):
        raise ValidationError(f"results and advancers must cover exactly groups {sorted(groups)}")

    members = [uid for g in groups.values() for uid in g.members]
    names = _display_names(db, cid, members)
    allocs = get_submissions(db, cid, r)
    writes = []
    for gid, group in sorted(groups.items()):
        result, advanced = results[gid], set(advancers[gid])
        ranked = [s.player_id for s in result.standings]
        if sorted(ranked) != sorted(group.members):
            raise ValidationError(f"group {gid} standings must list each member once")
        if not advanced <= set(group.members):
            raise ValidationError(f"group {gid} advancers must be group members")
        n = len(group.members)
        if len(result.matches) != n * (n - 1) // 2:
            raise ValidationError(f"group {gid} needs {n * (n - 1) // 2} matches, got {len(result.matches)}")

        rows = [StandingRow(
            uid=s.player_id,
            display_name=names.get(s.player_id, s.player_id),
            rank=s.rank,
            points=s.points,
            wins=s.wins,
            ties=s.ties,
            losses=s.losses,
            battlefields_won=s.battlefields_won,
            tiebreak=s.tiebreak,
            advanced=s.player_id in advanced,
        ) for s in result.standings]
        doc = Group(id=gid, round=r, members=group.members, advance_count=len(advanced), standings=rows)
        writes.append(("set", group_ref(db, cid, r, gid), doc.to_doc(), None))

        by_player = {uid: [] for uid in group.members}
        for m in result.matches:
            for me, opp, won, lost in ((m.player_a, m.player_b, m.battlefields_a, m.battlefields_b),
                                       (m.player_b, m.player_a, m.battlefields_b, m.battlefields_a)):
                by_player[me].append(MatchSummary(
                    opponent=opp,
                    opponent_name=names.get(opp, opp),
                    opponent_allocation=allocs[opp],
                    battlefields_won=won,
                    battlefields_lost=lost,
                    outcome=_outcome(m, me),
                ))
        for row in rows:
            res = PlayerResults(uid=row.uid, round=r, group_id=gid, allocation=allocs[row.uid],
                                rank=row.rank, points=row.points, advanced=row.advanced,
                                matches=by_player[row.uid])
            writes.append(("set", results_ref(db, cid, r, row.uid), res.to_doc(), None))

    # The precondition fails the commit if the round changed (e.g. published) since we read it.
    status = ("update", round_ref(db, cid, r), {"status": RoundStatus.SCORED.value, "scoredAt": now()},
              db.write_option(last_update_time=snap.update_time))
    _commit(db, writes, [status])


def publish_round(db, cid, r):
    """Reveals a scored round (admin.publishRound): eliminates non-advancers,
    crowns the champion after the final, rebuilds the leaderboard and copies
    the seed onto the round document. Everything lands in one batch at MVP scale.
    Returns the champion's uid after the final, else None.
    """
    snap, rnd = _round_snapshot(db, cid, r)
    if rnd.status != RoundStatus.SCORED:
        raise ConflictError(f"round {r} must be scored before publishing (it is {rnd.status})")
    seed = _get(round_secrets_ref(db, cid, r), RoundSecrets, f"round {r} secrets").seed
    groups = get_groups(db, cid, r)
    players = {s.id: Player.from_doc(s.to_dict()) for s in players_coll(db, cid).stream()}

    champion = None
    if rnd.is_final:
        (final,) = groups.values()
        winners = [row.uid for row in final.standings if row.advanced]
        if len(winners) != 1:
            raise ConflictError(f"the final must have exactly one advancer, got {len(winners)}")
        champion = winners[0]

    writes = []
    for gid, group in groups.items():
        for row in group.standings:
            p = players[row.uid]
            p.furthest_round = r
            p.last_result = LastResult(round=r, group_id=gid, rank=row.rank, points=row.points,
                                       battlefields_won=row.battlefields_won)
            if row.uid == champion:
                p.status = PlayerStatus.CHAMPION.value
            elif not row.advanced or rnd.is_final:
                p.status, p.round_eliminated = PlayerStatus.ELIMINATED.value, r
            writes.append(("update", player_ref(db, cid, row.uid), {
                "status": p.status,
                "roundEliminated": p.round_eliminated,
                "furthestRound": p.furthest_round,
                "lastResult": p.last_result.to_doc(),
            }, None))

    at = now()
    board = build_leaderboard(players, r, at)
    writes.append(("set", leaderboard_ref(db, cid), board.to_doc(), None))
    if champion:
        writes.append(("update", competition_ref(db, cid),
                       {"status": CompetitionStatus.COMPLETED.value, "championId": champion}, None))
    status = ("update", round_ref(db, cid, r),
              {"status": RoundStatus.PUBLISHED.value, "publishedAt": at, "seed": seed},
              db.write_option(last_update_time=snap.update_time))
    _commit(db, writes, [status])
    return champion

