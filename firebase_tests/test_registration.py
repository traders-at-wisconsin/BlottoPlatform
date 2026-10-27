"""Registration through callable dispatch, service boundaries and local HTTP wrapper."""
import inspect
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock

import pytest
from firebase_functions import https_fn
from firebase_admin import auth
from flask import Flask, request

from functions import main
from functions.game_api.api import Actor, ApiError
from functions.game_api.contracts import ServiceError
from functions.game_api.registration_contracts import RegistrationGrant
from functions.game_api.registration_mocks import MockRegistrationService
from functions.game_api.round_api import RoundAPI
from functions.game_api.round_mocks import MockCompetition, MockRoundService

BODY = {"competition_id": "demo", "display_name": "Alice"}
CLAIMS = {"email": "alice@example.test", "email_verified": True}


@pytest.fixture
def setup(monkeypatch):
    rounds = MockRoundService({"demo": MockCompetition({}, {})})
    registration = MockRegistrationService(rounds, {"demo": {"alice@example.test"}})
    api = RoundAPI(rounds, registration_service=registration, player_registration_service=registration)
    monkeypatch.setattr(main, "get_api", lambda: api)
    return api, rounds, registration


def invoke(data=BODY, uid="alice", claims=CLAIMS):
    context = None if uid is None else https_fn.AuthData(uid=uid, token=claims)
    return inspect.unwrap(main.joinCompetition)(https_fn.CallableRequest(data=data, raw_request=None, auth=context))


def fails(code, reason, **kwargs):
    with pytest.raises(https_fn.HttpsError) as exc:
        invoke(**kwargs)
    assert exc.value.code.value == code
    assert exc.value.details == {"reason": reason}
    assert "alice@example.test" not in str(exc.value)


def test_join_uses_verified_identity_and_minimal_response(setup):
    _, rounds, service = setup
    assert invoke() == {"competition_id": "demo", "registered": True}
    assert service.players["demo", "alice"] == {"email": CLAIMS["email"], "display_name": "Alice"}
    assert rounds.competitions["demo"].players == {"alice": True}


def test_requires_auth(setup):
    fails("unauthenticated", "authentication_required", uid=None)


@pytest.mark.parametrize("claims", [{}, {"email": CLAIMS["email"]},
    {"email": CLAIMS["email"], "email_verified": False},
    {"email": CLAIMS["email"], "email_verified": 1},
    {"email": CLAIMS["email"], "email_verified": "true"},
    {"email": None, "email_verified": True},
    {"email": " ", "email_verified": True},
    {"email": "bad", "email_verified": True}])
def test_requires_verified_email(setup, claims):
    fails("permission-denied", "verified_email_required", claims=claims)
    assert not setup[2].players


@pytest.mark.parametrize("data", [None, [], {}, {**BODY, "uid": "other"},
    {**BODY, "email": CLAIMS["email"]}, {**BODY, "admin": True},
    {**BODY, "competition_id": "../demo"}, {**BODY, "competition_id": 1},
    {**BODY, "display_name": ""}, {**BODY, "display_name": "  "},
    {**BODY, "display_name": "A" * 81}, {**BODY, "display_name": "A\nB"},
    {**BODY, "display_name": "Alice\n"},
    {**BODY, "display_name": True}, {**BODY, "display_name": "A\u200bB"},
    {**BODY, "extra": "x" * 65536}, {**BODY, "display_name": float("nan")}])
def test_invalid_requests_never_write(setup, data):
    fails("invalid-argument", "invalid_request", data=data)
    assert not setup[2].players


def test_name_trimmed(setup):
    invoke(data={**BODY, "display_name": "  Alice  "})
    assert setup[2].players["demo", "alice"]["display_name"] == "Alice"


def test_unallowlisted_and_admin_cannot_bypass(setup):
    for claims in ({**CLAIMS, "email": "outsider@example.test"},
                   {**CLAIMS, "email": "outsider@example.test", "admin": True}):
        fails("permission-denied", "registration_denied", claims=claims)
    assert not setup[2].players


def test_unknown_competition(setup):
    fails("not-found", "not_found", data={**BODY, "competition_id": "unknown"})


def test_retries_preserve_name_and_elimination(setup):
    invoke()
    setup[1].competitions["demo"].players["alice"] = False
    invoke(data={**BODY, "display_name": "Changed"})
    assert len(setup[2].players) == 1
    assert setup[2].players["demo", "alice"]["display_name"] == "Alice"
    assert setup[1].competitions["demo"].players["alice"] is False


def test_concurrent_duplicates_create_once(setup):
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: invoke(), range(24)))
    assert all(result == {"competition_id": "demo", "registered": True} for result in results)
    assert len(setup[2].players) == 1


def test_email_cannot_be_reused_by_another_uid(setup):
    invoke()
    fails("permission-denied", "registration_denied", uid="imposter")
    assert "imposter" not in setup[1].competitions["demo"].players


def test_uid_cannot_bind_second_email(setup):
    invoke()
    setup[2].allowlists["demo"].add("other@example.test")
    fails("permission-denied", "registration_denied", claims={**CLAIMS, "email": "other@example.test"})


def test_revocation_between_authorization_and_write(setup, monkeypatch):
    service = setup[2]
    original = service.authorize
    def revoke(*args):
        grant = original(*args)
        service.allowlists["demo"].clear()
        return grant
    monkeypatch.setattr(service, "authorize", revoke)
    fails("permission-denied", "registration_denied")
    assert not service.players
    assert not setup[1].competitions["demo"].players


@pytest.mark.parametrize("attribute", ["registration_service", "player_registration_service"])
def test_missing_adapter_fails_closed(setup, attribute):
    setattr(setup[0], attribute, None)
    fails("unavailable", "services_not_configured")


@pytest.mark.parametrize("method", ["authorize", "ensure_player"])
@pytest.mark.parametrize("reason,code", [("unavailable", "unavailable"), ("conflict", "aborted"),
    ("registration_denied", "permission-denied"), ("private database diagnostics", "internal")])
def test_service_errors_are_safe(setup, monkeypatch, method, reason, code):
    monkeypatch.setattr(setup[2], method, Mock(side_effect=ServiceError(reason)))
    fails(code, reason if code != "internal" else "internal")
    assert not setup[2].players


def test_unexpected_adapter_failure_is_sanitized(setup, monkeypatch):
    monkeypatch.setattr(setup[2], "ensure_player", Mock(side_effect=RuntimeError("private allocation")))
    fails("internal", "internal")


def test_mismatched_grant_fails_closed(setup, monkeypatch):
    monkeypatch.setattr(setup[2], "authorize", lambda *args: RegistrationGrant("demo", "other", CLAIMS["email"]))
    fails("internal", "internal")
    assert not setup[2].players


def test_missing_auth_before_composition(monkeypatch):
    monkeypatch.setattr(main, "get_api", Mock(side_effect=RuntimeError("must not compose")))
    fails("unauthenticated", "authentication_required", uid=None)


def test_join_callable_http_transport(setup, monkeypatch):
    # Actual Firebase HTTP wrapper, controlled token verifier; no live Auth call.
    monkeypatch.setattr(auth, "verify_id_token", lambda token, **kwargs: {"uid": "alice", **CLAIMS})
    app = Flask(__name__)
    with app.test_request_context("/", method="POST", json={"data": BODY},
                                  headers={"Authorization": "Bearer local-test-token"}):
        response = main.joinCompetition(request)
        assert response.status_code == 200
        assert response.get_json() == {"result": {"competition_id": "demo", "registered": True}}
    with app.test_request_context("/", method="POST", json={"data": BODY}):
        response = main.joinCompetition(request)
        assert response.status_code == 401


def test_registered_player_can_submit_using_shared_membership(setup):
    from datetime import datetime, timedelta, timezone
    from functions.game_api.round_mocks import MockRound
    api, rounds, _ = setup
    rounds.competitions["demo"].rounds["round-1"] = MockRound(
        deadline=datetime.now(timezone.utc) + timedelta(hours=1))
    allocation = {"competition_id": "demo", "round_id": "round-1", "allocation": [10] * 10}
    with pytest.raises(ApiError) as exc:
        api.call("submitAllocation", allocation, Actor("alice", CLAIMS))
    assert exc.value.reason == "player_ineligible"
    invoke()
    assert api.call("submitAllocation", allocation, Actor("alice", CLAIMS))["revision"] == 1


def test_allowlist_is_competition_scoped(setup):
    setup[1].competitions["other"] = MockCompetition({}, {})
    fails("permission-denied", "registration_denied", data={**BODY, "competition_id": "other"})
    assert not setup[1].competitions["other"].players


def test_concurrent_uids_cannot_claim_same_email(setup):
    api = setup[0]
    def join(uid):
        try:
            api.call("joinCompetition", BODY, Actor(uid, CLAIMS))
            return "ok"
        except ApiError as exc:
            return exc.reason
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(join, ["alice", "other"]))
    assert sorted(results) == ["ok", "registration_denied"]
    assert len(setup[2].players) == 1
