"""MVP tests replace match-locking assumptions; unchanged security cases remain."""
import inspect
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest
from firebase_functions import https_fn
from flask import Flask, request

from functions import main
from functions.game_api.api import Actor, ApiError
from functions.game_api.contracts import ServiceError
from functions.game_api.round_api import RoundAPI
from functions.game_api.round_contracts import AllocationConfig
from functions.game_api.round_mocks import MockCompetition, MockRound, MockRoundService
from functions.game_api.runtime import get_api

OPERATIONS = ("submitAllocation", "submit_game", "get_submission_status",
              "get_game_result", "admin_inspect_game", "admin_request_finalization")
REF = {"competition_id": "competition-1", "round_id": "round-1"}
BODY = {**REF, "allocation": [10] * 10}
NOW = datetime(2026, 10, 27, 12, tzinfo=timezone.utc)


@pytest.fixture
def setup(monkeypatch):
    time = [NOW]
    clock = lambda: time[0]
    service = MockRoundService({
        "competition-1": MockCompetition({"alice": True, "bob": True, "eliminated": False}, {
            "round-1": MockRound(NOW + timedelta(hours=1)),
            "round-2": MockRound(NOW + timedelta(hours=2)),
        }),
        "competition-2": MockCompetition({"alice": True}, {
            "round-1": MockRound(NOW + timedelta(hours=1)),
        }),
    }, clock=clock)
    api = RoundAPI(service, clock=clock)
    monkeypatch.setattr(main, "get_api", lambda: api)
    return api, service, time


def invoke(operation="submitAllocation", data=BODY, uid="alice", claims=None):
    auth = None if uid is None else https_fn.AuthData(uid=uid, token=claims or {})
    req = https_fn.CallableRequest(data=data, raw_request=None, auth=auth)
    return inspect.unwrap(getattr(main, operation))(req)


def error(code, operation="submitAllocation", **kwargs):
    with pytest.raises(https_fn.HttpsError) as caught:
        invoke(operation, **kwargs)
    assert caught.value.code.value == code
    assert set(caught.value.details) == {"reason"}
    return caught.value


def round_fixture(service):
    return service.competitions["competition-1"].rounds["round-1"]


@pytest.mark.parametrize("operation", OPERATIONS)
def test_all_require_auth(setup, operation):
    error("unauthenticated", operation, uid=None)


@pytest.mark.parametrize("operation", ["submitAllocation", "submit_game", "get_submission_status"])
@pytest.mark.parametrize("uid", ["outsider", "eliminated"])
def test_only_registered_active_players(setup, operation, uid):
    data = REF if operation == "get_submission_status" else BODY
    assert error("permission-denied", operation, uid=uid, data=data).details["reason"] == "player_ineligible"


@pytest.mark.parametrize("operation", ["admin_inspect_game", "admin_request_finalization"])
@pytest.mark.parametrize("claims", [{}, {"admin": "true"}, {"admin": 1}, {"role": "admin"}])
def test_admin_requires_exact_verified_claim(setup, operation, claims):
    error("permission-denied", operation, claims=claims)


@pytest.mark.parametrize("data", [
    None, {}, [], "bad", {"competition_id": 1, "round_id": "round-1"},
    {**BODY, "player_id": "bob"}, {**BODY, "admin": True},
    {**BODY, "competition_id": "a/b"}, {**BODY, "round_id": ""},
    {**BODY, "round_id": "x" * 129}, {**BODY, "competition_id": True},
    {**BODY, "deadline": "2099-01-01"}, {**BODY, "game_mode": "another-mode"},
    {"match_id": "old-match", "game_mode": "old-mode", "submission": {}},
    {**BODY, "extra": "s" * 65536},
])
def test_invalid_envelopes(setup, data):
    error("invalid-argument", data=data)


@pytest.mark.parametrize("allocation", [
    [], [10] * 9, [10] * 11, [0] * 10, [11] * 10,
    [-1, 21] + [10] * 8, [True] + [11] * 9,
    [10.0] * 10, ["10"] * 10, [None] + [10] * 9,
    None, "10,10", {"hill": 100}, [[10]] * 10, [float("nan")] * 10,
])
def test_invalid_allocations_never_save(setup, allocation):
    _, service, _ = setup
    error("invalid-argument", data={**REF, "allocation": allocation})
    assert round_fixture(service).allocations == {}


def test_zero_on_some_battlefields_allowed(setup):
    assert invoke(data={**REF, "allocation": [100] + [0] * 9})["submitted"]


@pytest.mark.parametrize("ref", [
    {"competition_id": "missing", "round_id": "round-1"},
    {"competition_id": "competition-1", "round_id": "missing"},
])
def test_unknown_competition_or_round(setup, ref):
    error("not-found", data={**ref, "allocation": [10] * 10})


def test_unregistered_caller_cannot_discover_rounds(setup):
    first = error("permission-denied", uid="outsider")
    second = error("permission-denied", uid="outsider", data={**BODY, "round_id": "missing"})
    assert first.message == second.message


def test_initial_submit_and_own_status(setup):
    assert invoke() == {**REF, "game_mode": "colonel-blotto", "submitted": True,
                         "revision": 1, "saved_at": NOW.isoformat()}
    assert invoke("get_submission_status", REF) == {
        **REF, "submitted": True, "revision": 1, "saved_at": NOW.isoformat()}
    assert invoke("get_submission_status", REF, uid="bob") == {
        **REF, "submitted": False, "revision": None, "saved_at": None}


def test_resubmit_replaces_one_allocation_and_identical_retries_succeed(setup):
    _, service, _ = setup
    assert invoke()["revision"] == 1
    new = {**REF, "allocation": [100] + [0] * 9}
    assert invoke(data=new)["revision"] == 2
    assert invoke(data=new)["revision"] == 3
    assert round_fixture(service).allocations == {"alice": new["allocation"]}
    assert len(round_fixture(service).receipts) == 1


def test_deprecated_submit_alias_uses_round_service(setup):
    invoke()
    assert invoke("submit_game", {**REF, "allocation": [100] + [0] * 9})["revision"] == 2
    error("invalid-argument", "submit_game", data={"match_id": "old", "submission": {}})


def test_player_round_and_competition_isolation(setup):
    _, service, _ = setup
    invoke()
    invoke(data={**BODY, "round_id": "round-2"})
    invoke(data={**BODY, "competition_id": "competition-2"})
    invoke(uid="bob", data={**REF, "allocation": [100] + [0] * 9})
    assert round_fixture(service).allocations["alice"] == [10] * 10
    assert round_fixture(service).receipts["bob"].revision == 1
    assert service.competitions["competition-1"].rounds["round-2"].receipts["alice"].revision == 1
    assert service.competitions["competition-2"].rounds["round-1"].receipts["alice"].revision == 1


@pytest.mark.parametrize("state", ["pending", "closed", "scoring", "published"])
def test_nonopen_rounds_reject(setup, state):
    _, service, _ = setup
    round_fixture(service).state = state
    assert error("failed-precondition").details["reason"] == "round_not_open"
    assert round_fixture(service).allocations == {}


@pytest.mark.parametrize("offset", [timedelta(0), timedelta(microseconds=1)])
def test_deadline_exclusive_and_preserves_previous_submission(setup, offset):
    _, service, time = setup
    invoke()
    time[0] = round_fixture(service).deadline + offset
    result = error("failed-precondition", data={**REF, "allocation": [100] + [0] * 9})
    assert result.details["reason"] == "deadline_passed"
    assert round_fixture(service).allocations["alice"] == [10] * 10
    assert round_fixture(service).receipts["alice"].revision == 1


def test_just_before_deadline_and_status_after_close(setup):
    _, service, time = setup
    time[0] = round_fixture(service).deadline - timedelta(microseconds=1)
    invoke()
    round_fixture(service).state = "closed"
    time[0] += timedelta(seconds=1)
    assert invoke("get_submission_status", REF)["submitted"]


@pytest.mark.parametrize("change,reason,code", [
    ("deadline", "deadline_passed", "failed-precondition"),
    ("close", "round_not_open", "failed-precondition"),
    ("eliminate", "player_ineligible", "permission-denied"),
    ("unregister", "player_ineligible", "permission-denied"),
    ("config", "configuration_changed", "failed-precondition"),
])
def test_atomic_save_rechecks_after_api_precheck(setup, monkeypatch, change, reason, code):
    _, service, time = setup
    save = service.replace_allocation
    def race(*args):
        round_ = round_fixture(service)
        if change == "deadline":
            time[0] = round_.deadline
        elif change == "close":
            round_.state = "closed"
        elif change == "eliminate":
            service.competitions["competition-1"].players["alice"] = False
        elif change == "unregister":
            del service.competitions["competition-1"].players["alice"]
        else:
            round_.config = replace(round_.config, version="mvp-2")
        return save(*args)
    monkeypatch.setattr(service, "replace_allocation", race)
    assert error(code).details["reason"] == reason
    assert round_fixture(service).allocations == {}


def test_api_checks_eligibility_returned_by_adapter(setup, monkeypatch):
    _, service, _ = setup
    context = service.get_context(**REF, uid="alice")
    monkeypatch.setattr(service, "get_context", lambda *args: replace(context, active=False))
    error("permission-denied")
    assert round_fixture(service).allocations == {}


def test_config_drives_validation_without_new_game_logic(setup):
    _, service, _ = setup
    round_fixture(service).config = AllocationConfig(soldiers=12, battlefields=3)
    error("invalid-argument")
    assert invoke(data={**REF, "allocation": [4, 4, 4]})["submitted"]


@pytest.mark.parametrize("bad_config", [True, False])
def test_bad_server_configuration_fails_safely(setup, bad_config):
    _, service, _ = setup
    if bad_config:
        round_fixture(service).config = AllocationConfig(battlefields=0)
    else:
        round_fixture(service).deadline = NOW.replace(tzinfo=None)
    assert error("unavailable").details["reason"] == "invalid_configuration"


def test_concurrent_resubmissions_keep_one_complete_latest_allocation(setup):
    _, service, _ = setup
    allocations = [[100 if i == j else 0 for i in range(10)] for j in range(10)]
    def send(allocation):
        return invoke(data={**REF, "allocation": allocation}), allocation
    with ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(send, allocations))
    assert sorted(receipt["revision"] for receipt, _ in results) == list(range(1, 11))
    latest, allocation = max(results, key=lambda result: result[0]["revision"])
    assert round_fixture(service).allocations == {"alice": allocation}
    assert latest["revision"] == 10


def test_admin_inspection_and_status_never_expose_moves(setup):
    invoke()
    assert invoke("admin_inspect_game", REF, uid="operator", claims={"admin": True}) == {
        **REF, "state": "open", "deadline": (NOW + timedelta(hours=1)).isoformat(),
        "game_mode": "colonel-blotto", "submitted_count": 1}
    for operation in ("get_submission_status", "admin_inspect_game"):
        assert "allocation" not in str(invoke(operation, REF, claims={"admin": True}))


def test_custom_admin_claim(setup):
    api, _, _ = setup
    api.admin_claim = "game_operator"
    error("permission-denied", "admin_inspect_game", data=REF, claims={"admin": True})
    assert invoke("admin_inspect_game", REF, claims={"game_operator": True})["submitted_count"] == 0


def test_legacy_result_and_finalization_are_migration_stubs(setup):
    _, service, _ = setup
    assert error("failed-precondition", "get_game_result", data=REF).details["reason"] == "direct_reads_required"
    result = error("failed-precondition", "admin_request_finalization", data=REF, claims={"admin": True})
    assert result.details["reason"] == "round_lifecycle_deferred"
    assert round_fixture(service).allocations == {}


@pytest.mark.parametrize("reason,code", [
    ("unavailable", "unavailable"), ("conflict", "aborted"),
    ("private unexpected details", "internal"),
])
def test_adapter_errors_are_sanitized(setup, monkeypatch, reason, code):
    _, service, _ = setup
    def fail(*args):
        raise ServiceError(reason)
    monkeypatch.setattr(service, "replace_allocation", fail)
    result = error(code)
    assert "private" not in str(result.details)
    assert "[10" not in result.message


def test_unexpected_error_is_sanitized(setup, monkeypatch):
    _, service, _ = setup
    def fail(*args):
        raise RuntimeError("database password and secret moves")
    monkeypatch.setattr(service, "get_context", fail)
    assert "password" not in error("internal").message


def test_runtime_fails_closed_and_emulator_uses_only_mvp(monkeypatch):
    get_api.cache_clear()
    monkeypatch.setenv("GAME_API_BACKEND", "mock")
    monkeypatch.delenv("FUNCTIONS_EMULATOR", raising=False)
    with pytest.raises(ApiError, match="not configured"):
        get_api()
    monkeypatch.setenv("FUNCTIONS_EMULATOR", "true")
    api = get_api()
    assert api.call("get_submission_status", {"competition_id": "demo", "round_id": "round-1"},
                    Actor("alice"))["submitted"] is False
    assert api.service.competitions["demo"].rounds["round-1"].config == AllocationConfig()
    get_api.cache_clear()


@pytest.mark.parametrize("operation", OPERATIONS)
def test_real_http_wrapper_serializes_auth_errors(setup, operation):
    app = Flask(__name__)
    with app.test_request_context("/", method="POST", json={"data": BODY}):
        response = getattr(main, operation)(request)
    assert response.status_code == 401
    assert response.get_json()["error"] == {
        "status": "UNAUTHENTICATED", "message": "Sign in to continue.",
        "details": {"reason": "authentication_required"},
    }


def test_real_http_wrapper_rejects_malformed_callable_envelope(setup):
    app = Flask(__name__)
    with app.test_request_context("/", method="POST", json={"allocation": "wrong envelope"}):
        response = main.submitAllocation(request)
    assert response.status_code == 400
    assert response.get_json()["error"]["status"] == "INVALID_ARGUMENT"


def test_phase_two_callables_exported():
    for name in ("openRound", "closeRound", "scoreRound", "publishRound"):
        assert hasattr(main, name)
