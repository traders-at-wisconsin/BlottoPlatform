"""HTTP-style local smoke tests: real callable wrappers, fake Auth and services.

Run from the repository root:
    .venv/bin/python -m pytest firebase_tests/test_local_smoke.py -v -s

No socket, Firebase project, credential, database, or emulator is used. The Auth
stub is TEST ONLY: it simulates verified claims, not JWT/signature verification.
"""
import socket
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from unittest.mock import create_autospec

import pytest
from firebase_admin import auth
from flask import Flask, request

from functions import main
from functions.game_api.lifecycle_mocks import MockLifecycleEffects, MockLifecycleService
from functions.game_api.round_api import RoundAPI
from functions.game_api.round_mocks import MockCompetition


LIFECYCLE = {"competition_id": "smoke", "round_number": 1}
ROUND = {"competition_id": "smoke", "round_id": "round-1"}
SCORE = {**LIFECYCLE, "idempotency_key": "smoke-score-1"}
PUBLISH = {**LIFECYCLE, "expected_scoring_revision": 1}
ENTRIES = ("openRound", "closeRound", "scoreRound", "publishRound", "submitAllocation",
           "submit_game", "get_submission_status", "admin_inspect_game", "get_game_result",
           "admin_request_finalization")
PRIVATE_FIELDS = {"allocation", "allocations", "seed", "standings", "groups", "winner", "champion"}
ADMIN_REQUESTS = (
    ("openRound", None), ("closeRound", LIFECYCLE), ("scoreRound", SCORE),
    ("publishRound", PUBLISH), ("admin_inspect_game", ROUND),
)


def assert_no_private_fields(value):
    if isinstance(value, dict):
        assert not PRIVATE_FIELDS.intersection(value)
        for child in value.values():
            assert_no_private_fields(child)
    elif isinstance(value, list):
        for child in value:
            assert_no_private_fields(child)


@dataclass
class LocalSmoke:
    client: object
    service: MockLifecycleService
    effects: object
    clock: list
    deadline: datetime
    verified_tokens: list

    @property
    def opening(self):
        return {**LIFECYCLE, "deadline": self.deadline.isoformat()}

    @property
    def stored_round(self):
        return self.service.competitions["smoke"].rounds["round-1"]

    @property
    def workflow(self):
        return self.service.workflows[("smoke", "round-1")]

    def post(self, name, data, player="admin", expected=200, reason=None):
        headers = {} if player is None else {"Authorization": f"Bearer local-{player}"}
        response = self.client.post(f"/{name}", json={"data": data}, headers=headers)
        body = response.get_json()
        assert response.status_code == expected, (name, response.status_code, body)
        assert_no_private_fields(body)
        workflow = self.service.workflows.get(("smoke", "round-1"))
        if workflow is not None:
            assert str(workflow.seed) not in str(body)
        if expected == 200:
            assert set(body) == {"result"}
            return body["result"]
        assert set(body) == {"error"}
        if reason is not None:
            assert body["error"]["details"] == {"reason": reason}
        # SDK transport failures can omit our application-specific reason.
        return body["error"]


@pytest.fixture
def local_smoke(monkeypatch):
    # A real UTC starting time gives this run a genuinely future deadline, while
    # subsequent controlled clock changes make boundaries deterministic and fast.
    clock = [datetime.now(timezone.utc)]
    deadline = clock[0] + timedelta(hours=1)
    effects = create_autospec(MockLifecycleEffects, instance=True)
    service = MockLifecycleService({
        "smoke": MockCompetition({"alice": True, "bob": True, "eliminated": False}, {}),
    }, clock=lambda: clock[0], effects=effects)
    api = RoundAPI(service, clock=lambda: clock[0], lifecycle_service=service, scoring_service=service)
    monkeypatch.setattr(main, "get_api", lambda: api)

    tokens = {
        "local-admin": {"uid": "operator", "admin": True},
        "local-alice": {"uid": "alice"}, "local-bob": {"uid": "bob"},
        "local-outsider": {"uid": "outsider"}, "local-eliminated": {"uid": "eliminated"},
    }
    verified = []
    def fake_verify(token, *args, **kwargs):
        verified.append(token)
        if token not in tokens:
            raise ValueError("Unknown local test token")
        return dict(tokens[token])
    monkeypatch.setattr(auth, "verify_id_token", fake_verify)
    def no_network(*args, **kwargs):
        raise AssertionError("Smoke tests must never open a network connection")
    monkeypatch.setattr(socket.socket, "connect", no_network)

    app = Flask(__name__)
    app.config["TESTING"] = True
    for name in ENTRIES:
        # Real exported @https_fn.on_call functions: no inspect.unwrap or direct
        # handler calls. Flask provides real request contexts and JSON responses.
        entry = getattr(main, name)
        # Functions Framework normally passes the Flask request argument. Flask
        # routes do not, so this test-only adapter supplies that same argument.
        app.add_url_rule(f"/{name}", endpoint=name,
                         view_func=lambda entry=entry: entry(request), methods=["POST"])
    with app.test_client() as client:
        yield LocalSmoke(client, service, effects, clock, deadline, verified)


def test_full_round_through_callable_http_entry_points(local_smoke):
    smoke = local_smoke
    opened = smoke.post("openRound", smoke.opening)
    assert opened["state"] == "open"
    seed = smoke.workflow.seed
    print("1. Admin opened round; private seed stored by mock service.")

    first, latest = [10] * 10, [0, 20] * 5
    assert smoke.post("submitAllocation", {**ROUND, "allocation": first}, "alice")["revision"] == 1
    print("2. Active registered player submitted a valid allocation.")
    assert smoke.post("submitAllocation", {**ROUND, "allocation": latest}, "alice")["revision"] == 2
    assert smoke.stored_round.allocations == {"alice": latest}
    print("3–4. Resubmission replaced the original; one allocation remains.")

    assert smoke.post("submitAllocation", {**ROUND, "allocation": first}, "bob")["submitted"]
    assert set(smoke.stored_round.allocations) == {"alice", "bob"}
    print("5. Second authorized player submitted.")

    status = smoke.post("get_submission_status", ROUND, "alice")
    assert set(status) == {"competition_id", "round_id", "submitted", "revision", "saved_at"}
    smoke.post("admin_inspect_game", ROUND, "alice", 403, "admin_required")
    smoke.post("get_submission_status", {**ROUND, "player_id": "bob"}, "alice", 400, "invalid_request")
    smoke.post("get_game_result", ROUND, "alice", 400, "direct_reads_required")
    print("6. Player sees own metadata only; admin inspection and identity overrides rejected.")

    smoke.post("closeRound", LIFECYCLE, expected=400, reason="deadline_not_reached")
    smoke.clock[0] = smoke.deadline
    assert smoke.post("closeRound", LIFECYCLE)["state"] == "closed"
    assert smoke.workflow.frozen_allocations == {"alice": latest, "bob": first}
    smoke.effects.prepare_closure.assert_called_once_with(
        "smoke", "round-1", {"alice": latest, "bob": first}, seed)
    print("7. Clock reached deadline; admin closed and delegated closure once.")

    smoke.post("submitAllocation", {**ROUND, "allocation": first}, "alice", 400, "round_not_open")
    assert smoke.stored_round.receipts["alice"].revision == 2
    print("8. Post-closure submission rejected without modifying stored allocation.")

    queued = smoke.post("scoreRound", SCORE)
    assert (queued["state"], queued["scoring_status"]) == ("closed", "queued")
    smoke.effects.prepare_scoring.assert_called_once_with("smoke", "round-1", 1)
    assert smoke.workflow.scoring_jobs == 1
    assert "result" not in queued and "winner" not in queued
    smoke.post("publishRound", PUBLISH, expected=400, reason="scoring_incomplete")
    assert smoke.post("scoreRound", SCORE) == queued
    print("9–10. Scoring delegated once; round remains queued and cannot publish yet.")

    # Explicitly stand in for the external worker; no game calculation runs.
    smoke.service.complete_scoring_fixture("smoke", 1, 1)
    assert smoke.post("scoreRound", SCORE)["scoring_status"] == "completed"
    smoke.post("get_game_result", ROUND, "alice", 400, "direct_reads_required")
    published = smoke.post("publishRound", PUBLISH)
    assert published["state"] == "published"
    smoke.effects.prepare_publication.assert_called_once_with("smoke", "round-1", 1)
    print("11. Simulated external worker completion; admin published via mock service.")

    for _ in range(3):
        assert smoke.post("publishRound", PUBLISH) == published
        assert smoke.post("closeRound", LIFECYCLE)["state"] == "published"
        assert smoke.post("openRound", smoke.opening)["state"] == "published"
    smoke.post("scoreRound", SCORE, expected=400, reason="invalid_transition")
    assert smoke.workflow.closure_count == smoke.workflow.scoring_jobs == smoke.workflow.publication_count == 1
    assert smoke.workflow.seed == seed
    assert smoke.effects.prepare_closure.call_count == smoke.effects.prepare_scoring.call_count == smoke.effects.prepare_publication.call_count == 1
    assert {"local-admin", "local-alice", "local-bob"} <= set(smoke.verified_tokens)
    print("12. Retries caused no duplicate closure, scoring, publication, or seed changes.")


@pytest.mark.parametrize("allocation", [
    [10] * 9, [10] * 11, [-1, 21] + [10] * 8, [0] * 10,
    [10.0] * 10, ["10"] * 10, [True] + [11] * 9, None,
])
def test_invalid_allocation_preserves_accepted_submission(local_smoke, allocation):
    smoke = local_smoke
    smoke.post("openRound", smoke.opening)
    smoke.post("submitAllocation", {**ROUND, "allocation": [10] * 10}, "alice")
    before = deepcopy(smoke.stored_round)
    rejected = smoke.post("submitAllocation", {**ROUND, "allocation": allocation}, "alice", 400)
    assert rejected["status"] == "INVALID_ARGUMENT"
    assert smoke.stored_round == before


@pytest.mark.parametrize("operation,data", ADMIN_REQUESTS)
def test_nonadmins_cannot_call_admin_http_endpoints(local_smoke, operation, data):
    smoke = local_smoke
    smoke.post(operation, smoke.opening if data is None else data, "alice", 403, "admin_required")
    assert smoke.service.competitions["smoke"].rounds == {}


@pytest.mark.parametrize("identity", ["outsider", "eliminated"])
def test_ineligible_players_cannot_submit(local_smoke, identity):
    local_smoke.post("openRound", local_smoke.opening)
    local_smoke.post("submitAllocation", {**ROUND, "allocation": [10] * 10}, identity, 403, "player_ineligible")
    assert local_smoke.stored_round.allocations == {}


@pytest.mark.parametrize("operation,data", [
    ("submitAllocation", {**ROUND, "round_id": "missing", "allocation": [10] * 10}),
    ("get_submission_status", {**ROUND, "round_id": "missing"}),
    ("closeRound", LIFECYCLE), ("scoreRound", SCORE), ("publishRound", PUBLISH),
])
def test_nonexistent_rounds_through_http(local_smoke, operation, data):
    player = "alice" if operation in {"submitAllocation", "get_submission_status"} else "admin"
    local_smoke.post(operation, data, player, 404, "not_found")


def test_deadline_boundaries_and_frozen_latest_snapshot(local_smoke):
    smoke = local_smoke
    smoke.post("openRound", smoke.opening)
    valid = {**ROUND, "allocation": [10] * 10}
    smoke.clock[0] = smoke.deadline - timedelta(microseconds=1)
    smoke.post("submitAllocation", valid, "alice")
    smoke.post("closeRound", LIFECYCLE, expected=400, reason="deadline_not_reached")
    for delta in (timedelta(0), timedelta(microseconds=1)):
        smoke.clock[0] = smoke.deadline + delta
        smoke.post("submitAllocation", valid, "alice", 400, "deadline_passed")
    assert smoke.stored_round.receipts["alice"].revision == 1
    smoke.post("closeRound", LIFECYCLE)
    assert smoke.workflow.frozen_allocations == {"alice": valid["allocation"]}


@pytest.mark.parametrize("offset", [timedelta(0), -timedelta(seconds=1)])
def test_open_deadline_must_be_future(local_smoke, offset):
    smoke = local_smoke
    smoke.post("openRound", {**LIFECYCLE, "deadline": (smoke.clock[0] + offset).isoformat()},
               expected=400, reason="invalid_deadline")
    assert smoke.service.competitions["smoke"].rounds == {}


def test_http_transport_handles_missing_and_unknown_tokens_and_bad_envelopes(local_smoke):
    smoke = local_smoke
    smoke.post("openRound", smoke.opening, None, 401, "authentication_required")
    error = smoke.post("openRound", smoke.opening, "unknown", 401)
    assert error["status"] == "UNAUTHENTICATED"
    response = smoke.client.post("/submitAllocation", json={"allocation": [10] * 10})
    assert response.status_code == 400
    assert response.get_json()["error"]["status"] == "INVALID_ARGUMENT"
