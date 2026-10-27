"""Admin lifecycle contract tests. No Firebase project or game engine required."""
import inspect
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier

import pytest
from firebase_functions import https_fn
from flask import Flask, request

from functions import main
from functions.game_api.api import Actor, ApiError
from functions.game_api.contracts import ServiceError
from functions.game_api.lifecycle_mocks import MockLifecycleService
from functions.game_api.round_api import RoundAPI
from functions.game_api.round_mocks import MockCompetition

OPS = ("openRound", "closeRound", "scoreRound", "publishRound")
NOW = datetime(2026, 10, 27, 12, tzinfo=timezone.utc)
REF = {"competition_id": "demo", "round_number": 1}
OPEN = {**REF, "deadline": (NOW + timedelta(hours=1)).isoformat()}
SCORE = {**REF, "idempotency_key": "score-1"}
PUBLISH = {**REF, "expected_scoring_revision": 1}


@pytest.fixture
def game(monkeypatch):
    time = [NOW]
    service = MockLifecycleService({"demo": MockCompetition({"alice": True, "bob": True}, {})},
                                   clock=lambda: time[0])
    api = RoundAPI(service, clock=lambda: time[0], lifecycle_service=service, scoring_service=service)
    monkeypatch.setattr(main, "get_api", lambda: api)
    return api, service, time


def call(operation, data=None, uid="operator", claims=None):
    if data is None:
        data = {"openRound": OPEN, "closeRound": REF, "scoreRound": SCORE,
                "publishRound": PUBLISH}[operation]
    auth = None if uid is None else https_fn.AuthData(uid, {"admin": True} if claims is None else claims)
    return inspect.unwrap(getattr(main, operation))(https_fn.CallableRequest(data, None, auth=auth))


def fails(operation, code, reason=None, **kwargs):
    with pytest.raises(https_fn.HttpsError) as caught:
        call(operation, **kwargs)
    assert caught.value.code.value == code
    if reason:
        assert caught.value.details == {"reason": reason}
    return caught.value


def workflow(game):
    return game[1].workflows[("demo", "round-1")]


def close(game):
    call("openRound")
    game[2][0] = NOW + timedelta(hours=1)
    return call("closeRound")


def scored(game):
    close(game)
    call("scoreRound")
    game[1].complete_scoring_fixture("demo", 1, 1)


@pytest.mark.parametrize("operation", OPS)
def test_requires_verified_auth(game, operation):
    fails(operation, "unauthenticated", "authentication_required", uid=None)


@pytest.mark.parametrize("operation", OPS)
@pytest.mark.parametrize("claims", [{}, {"admin": False}, {"admin": 1}, {"admin": "true"}])
def test_requires_boolean_admin_claim(game, operation, claims):
    fails(operation, "permission-denied", "admin_required", claims=claims)
    assert game[1].competitions["demo"].rounds == {}


def test_custom_admin_claim(game):
    game[0].admin_claim = "competition_admin"
    fails("openRound", "permission-denied")
    assert call("openRound", claims={"competition_admin": True})["state"] == "open"


@pytest.mark.parametrize("value", [None, True, 0, -1, 1.5, "1"])
def test_invalid_round_number(game, value):
    fails("openRound", "invalid-argument", data={**OPEN, "round_number": value})


@pytest.mark.parametrize("data", [
    {}, [], "bad", {**OPEN, "competition_id": "a/b"}, {**OPEN, "competition_id": ""},
    {**OPEN, "competition_id": 12}, {**OPEN, "admin": True}, {**OPEN, "seed": 5},
    {**OPEN, "round_id": "round-1"}, {**OPEN, "extra": "a" * 65536},
])
def test_invalid_envelope(game, data):
    fails("openRound", "invalid-argument", data=data)


@pytest.mark.parametrize("deadline", [None, 123, "tomorrow", "2026-10-28", "2026-10-28T12:00:00"])
def test_malformed_or_naive_deadlines(game, deadline):
    fails("openRound", "invalid-argument", data={**OPEN, "deadline": deadline})


@pytest.mark.parametrize("delta", [timedelta(0), -timedelta(microseconds=1)])
def test_new_open_requires_future_deadline(game, delta):
    fails("openRound", "invalid-argument", "invalid_deadline",
          data={**OPEN, "deadline": (NOW + delta).isoformat()})
    assert game[1].competitions["demo"].rounds == {}


def test_open_retry_keeps_seed_and_deadline_even_after_deadline(game):
    initial = call("openRound")
    seed = workflow(game).seed
    game[2][0] = NOW + timedelta(hours=2)
    assert call("openRound") == initial
    assert workflow(game).seed == seed
    fails("openRound", "already-exists", "round_conflict",
          data={**OPEN, "deadline": (NOW + timedelta(hours=4)).isoformat()})


def test_unknown_competition_and_round(game):
    fails("openRound", "not-found", data={**OPEN, "competition_id": "missing"})
    for op in OPS[1:]:
        fails(op, "not-found")


def test_close_deadline_boundary_and_phase_one_integration(game):
    call("openRound")
    submission = {"competition_id": "demo", "round_id": "round-1", "allocation": [10] * 10}
    game[0].call("submitAllocation", submission, Actor("alice"))
    game[2][0] = NOW + timedelta(hours=1) - timedelta(microseconds=1)
    fails("closeRound", "failed-precondition", "deadline_not_reached")
    game[2][0] += timedelta(microseconds=1)
    assert call("closeRound")["state"] == "closed"
    assert workflow(game).frozen_allocations == {"alice": [10] * 10}
    with pytest.raises(ApiError) as caught:
        game[0].call("submitAllocation", submission, Actor("alice"))
    assert caught.value.reason == "round_not_open"


def test_duplicate_closure_does_not_repeat_delegated_work(game, monkeypatch):
    seen = []
    monkeypatch.setattr(game[1].effects, "prepare_closure", lambda *args: seen.append(args))
    first = close(game)
    assert call("closeRound") == first
    assert len(seen) == workflow(game).closure_count == 1
    assert seen[0][3] == workflow(game).seed


def test_failed_closure_exposes_no_partial_completion_and_can_retry(game, monkeypatch):
    call("openRound")
    game[2][0] = NOW + timedelta(hours=1)
    def fail(*args):
        raise ServiceError("unavailable")
    monkeypatch.setattr(game[1].effects, "prepare_closure", fail)
    fails("closeRound", "unavailable")
    assert game[1].competitions["demo"].rounds["round-1"].state == "open"
    assert workflow(game).closure_count == 0
    assert workflow(game).frozen_allocations is None
    monkeypatch.setattr(game[1].effects, "prepare_closure", lambda *args: None)
    call("closeRound")
    assert workflow(game).closure_count == 1


def test_scoring_requires_closed_round_and_is_status_only(game):
    call("openRound")
    fails("scoreRound", "failed-precondition", "invalid_transition")
    close(game)
    first = call("scoreRound")
    assert first["state"] == "closed" and first["scoring_status"] == "queued"
    assert call("scoreRound") == first  # Poll same request, no second job.
    assert workflow(game).scoring_jobs == 1
    fails("scoreRound", "failed-precondition", "scoring_in_progress",
          data={**SCORE, "idempotency_key": "different"})
    fails("publishRound", "failed-precondition", "scoring_incomplete")
    game[1].complete_scoring_fixture("demo", 1, 1)
    assert call("scoreRound")["state"] == "scored"


@pytest.mark.parametrize("changes", [
    {"idempotency_key": ""}, {"rescore": "true"}, {"rescore": True},
    {"expected_scoring_revision": 1}, {"rescore": True, "expected_scoring_revision": True},
])
def test_rescore_request_must_be_explicit_and_valid(game, changes):
    fails("scoreRound", "invalid-argument", data={**SCORE, **changes})


def test_rescore_is_revision_fenced_and_private(game):
    scored(game)
    fails("scoreRound", "failed-precondition", "rescore_required",
          data={**SCORE, "idempotency_key": "new"})
    rescore = {**SCORE, "idempotency_key": "rescore-2", "rescore": True, "expected_scoring_revision": 1}
    result = call("scoreRound", rescore)
    assert result["state"] == "closed" and result["scoring_revision"] == 2
    fails("publishRound", "failed-precondition")
    with pytest.raises(ServiceError, match="stale_revision"):
        game[1].complete_scoring_fixture("demo", 1, 1)
    game[1].complete_scoring_fixture("demo", 1, 2)
    assert call("scoreRound", rescore)["state"] == "scored"
    fails("publishRound", "failed-precondition", "stale_revision")
    assert call("publishRound", {**PUBLISH, "expected_scoring_revision": 2})["state"] == "published"
    fails("scoreRound", "failed-precondition", "invalid_transition", data=rescore)


def test_failed_scoring_requires_explicit_retry(game):
    close(game)
    call("scoreRound")
    game[1].complete_scoring_fixture("demo", 1, 1, success=False)
    assert call("scoreRound")["scoring_status"] == "failed"
    fails("publishRound", "failed-precondition")
    assert call("scoreRound", {**SCORE, "idempotency_key": "retry", "rescore": True,
                                "expected_scoring_revision": 1})["scoring_revision"] == 2


def test_reused_key_with_changed_arguments_conflicts(game):
    scored(game)
    fails("scoreRound", "already-exists", "idempotency_conflict",
          data={**SCORE, "rescore": True, "expected_scoring_revision": 1})


def test_publication_policy_and_duplicate_effect_guard(game, monkeypatch):
    scored(game)
    workflow(game).publication_permitted = False
    fails("publishRound", "failed-precondition", "publication_not_permitted")
    assert workflow(game).publication_count == 0
    workflow(game).publication_permitted = True
    seen = []
    monkeypatch.setattr(game[1].effects, "prepare_publication", lambda *args: seen.append(args))
    first = call("publishRound")
    assert call("publishRound") == first
    assert first["state"] == "published"
    assert workflow(game).publication_count == len(seen) == 1
    # Retrying earlier commands does not reopen a published round.
    assert call("openRound")["state"] == "published"
    assert call("closeRound")["state"] == "published"


@pytest.mark.parametrize("operation,hook", [("scoreRound", "prepare_scoring"),
                                           ("publishRound", "prepare_publication")])
def test_staged_service_failure_does_not_commit_partial_state(game, monkeypatch, operation, hook):
    scored(game) if operation == "publishRound" else close(game)
    before = game[1].lifecycle_status("demo", 1, "operator")
    def fail(*args):
        raise RuntimeError("private seed and unpublished results")
    monkeypatch.setattr(game[1].effects, hook, fail)
    result = fails(operation, "internal", "internal")
    assert "private" not in result.message
    assert game[1].lifecycle_status("demo", 1, "operator") == before
    monkeypatch.setattr(game[1].effects, hook, lambda *args: None)
    call(operation)


def test_lifecycle_projection_never_contains_private_data(game):
    seen = [call("openRound"), close(game), call("scoreRound")]
    game[1].complete_scoring_fixture("demo", 1, 1)
    seen.append(call("publishRound"))
    for response in seen:
        assert set(response) == {"competition_id", "round_id", "round_number", "state", "deadline",
                                 "scoring_revision", "scoring_status"}
        assert str(workflow(game).seed) not in str(response)
    fails("publishRound", "permission-denied", claims={})


def test_concurrent_open_close_score_publish_are_idempotent(game):
    def parallel(op):
        with ThreadPoolExecutor(max_workers=6) as pool:
            return list(pool.map(lambda _: call(op), range(6)))
    opened = parallel("openRound")
    assert all(item == opened[0] for item in opened)
    seed = workflow(game).seed
    game[2][0] = NOW + timedelta(hours=1)
    parallel("closeRound")
    assert workflow(game).closure_count == 1 and workflow(game).seed == seed
    parallel("scoreRound")
    assert workflow(game).scoring_jobs == 1
    game[1].complete_scoring_fixture("demo", 1, 1)
    parallel("publishRound")
    assert workflow(game).publication_count == 1


def test_concurrent_rescore_vs_publish_has_one_winner(game):
    scored(game)
    barrier = Barrier(2)
    def run(op):
        barrier.wait()
        try:
            data = {**SCORE, "idempotency_key": "rescore", "rescore": True,
                    "expected_scoring_revision": 1} if op == "scoreRound" else PUBLISH
            call(op, data)
            return "success"
        except https_fn.HttpsError as exc:
            assert exc.code.value == "failed-precondition"
            return "rejected"
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, ("scoreRound", "publishRound")))
    assert sorted(results) == ["rejected", "success"]
    assert workflow(game).publication_count + (workflow(game).scoring_revision - 1) == 1


@pytest.mark.parametrize("reason,code", [("unavailable", "unavailable"), ("conflict", "aborted"),
                                         ("private error", "internal")])
def test_backend_errors_are_stable_and_sanitized(game, monkeypatch, reason, code):
    def fail(*args):
        raise ServiceError(reason)
    monkeypatch.setattr(game[1], "open_round", fail)
    result = fails("openRound", code)
    assert "private" not in str(result.details)


def test_missing_adapters_fail_closed(game):
    game[0].lifecycle_service = None
    fails("openRound", "unavailable")


def test_missing_scoring_adapter_fails_closed(game):
    close(game)
    game[0].scoring_service = None
    fails("scoreRound", "unavailable")
    assert workflow(game).scoring_jobs == 0


@pytest.mark.parametrize("revision", [None, True, 0, "1", -1])
def test_publication_requires_explicit_valid_revision(game, revision):
    fails("publishRound", "invalid-argument", data={**PUBLISH, "expected_scoring_revision": revision})


def test_simultaneous_rescores_require_one_revision_claim(game):
    scored(game)
    def rescore(index):
        try:
            call("scoreRound", {**SCORE, "idempotency_key": f"rescore-{index}", "rescore": True,
                                "expected_scoring_revision": 1})
            return True
        except https_fn.HttpsError as exc:
            assert exc.code.value == "failed-precondition"
            return False
    with ThreadPoolExecutor(max_workers=5) as pool:
        assert sum(pool.map(rescore, range(5))) == 1
    assert workflow(game).scoring_revision == 2
    assert workflow(game).scoring_jobs == 2


def test_service_rechecks_close_deadline_after_api_precheck(game, monkeypatch):
    call("openRound")
    game[2][0] = NOW + timedelta(hours=1)
    close_service = game[1].close_round
    def race(*args):
        # Simulate a corrected authoritative deadline after the API's status read.
        game[1].competitions["demo"].rounds["round-1"].deadline += timedelta(hours=1)
        return close_service(*args)
    monkeypatch.setattr(game[1], "close_round", race)
    fails("closeRound", "failed-precondition", "deadline_not_reached")
    assert workflow(game).closure_count == 0


def test_service_rechecks_publication_after_api_precheck(game, monkeypatch):
    scored(game)
    publish_service = game[1].publish_round
    def race(*args):
        game[1].request_scoring("demo", 1, "racing-rescore", True, 1, "another-admin")
        return publish_service(*args)
    monkeypatch.setattr(game[1], "publish_round", race)
    fails("publishRound", "failed-precondition", "stale_revision")
    assert workflow(game).publication_count == 0


def test_open_service_uses_fresh_time(game, monkeypatch):
    open_service = game[1].open_round
    def delay(*args):
        game[2][0] = NOW + timedelta(hours=1)
        return open_service(*args)
    monkeypatch.setattr(game[1], "open_round", delay)
    fails("openRound", "invalid-argument", "invalid_deadline")
    assert game[1].competitions["demo"].rounds == {}


@pytest.mark.parametrize("operation", OPS)
def test_real_callable_transport_auth_errors(game, operation):
    app = Flask(__name__)
    with app.test_request_context("/", method="POST", json={"data": REF}):
        response = getattr(main, operation)(request)
    assert response.status_code == 401
    assert response.get_json()["error"]["details"] == {"reason": "authentication_required"}
