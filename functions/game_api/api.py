"""Transport-independent handlers: auth, generic validation, delegation."""
import json
from dataclasses import dataclass, field
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, JsonValue, ValidationError

from .contracts import ServiceError, Services


Identifier = Annotated[str, Field(strict=True, min_length=1, max_length=128,
                                  pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$")]


class MatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    match_id: Identifier
    game_mode: Identifier


class SubmitRequest(MatchRequest):
    submission: dict[str, JsonValue]


class FinalizeRequest(MatchRequest):
    idempotency_key: Identifier


@dataclass(frozen=True)
class Actor:
    uid: str
    claims: dict[str, Any] = field(default_factory=dict)


class ApiError(Exception):
    def __init__(self, code: str, reason: str, message: str):
        self.code, self.reason, self.message = code, reason, message
        super().__init__(message)


SERVICE_ERRORS = {
    "not_found": ("not-found", "Match not found."),
    "already_exists": ("already-exists", "Submission already locked."),
    "invalid_submission": ("invalid-argument", "Submission rejected by the game-mode service."),
    "failed_precondition": ("failed-precondition", "The operation is not available in the current game state."),
    "unavailable": ("unavailable", "The required service is unavailable."),
}


class GameAPI:
    def __init__(self, services: Services, game_modes: frozenset[str], admin_claim: str = "admin"):
        self.services = services
        self.game_modes = game_modes
        self.admin_claim = admin_claim

    def call(self, operation: str, data: Any, actor: Actor | None) -> dict:
        try:
            return self._call(operation, data, actor)
        except ServiceError as exc:
            code, message = SERVICE_ERRORS.get(exc.reason, ("internal", "The operation could not be completed."))
            reason = exc.reason if exc.reason in SERVICE_ERRORS else "internal"
            raise ApiError(code, reason, message) from None
        except ApiError:
            raise
        except Exception:
            # Never expose internal errors, submitted moves, or service responses.
            raise ApiError("internal", "internal", "The operation could not be completed.") from None

    def _call(self, operation: str, data: Any, actor: Actor | None) -> dict:
        if actor is None or not actor.uid:
            raise ApiError("unauthenticated", "authentication_required", "Sign in to continue.")
        admin = operation in {"admin_inspect_game", "admin_request_finalization"}
        if admin and actor.claims.get(self.admin_claim) is not True:
            raise ApiError("permission-denied", "admin_required", "Administrator access required.")
        model = {"submit_game": SubmitRequest, "get_submission_status": MatchRequest,
                 "get_game_result": MatchRequest, "admin_inspect_game": MatchRequest,
                 "admin_request_finalization": FinalizeRequest}.get(operation)
        if model is None:
            raise ApiError("not-found", "unknown_operation", "Operation not found.")
        try:
            # Generic transport limit, not a game rule. Reject non-JSON and NaN.
            encoded = json.dumps(data, allow_nan=False).encode("utf-8")
            if len(encoded) > 65536:
                raise ValueError("Request too large")
            request = model.model_validate(data)
        except (ValidationError, ValueError, TypeError, RecursionError):
            raise ApiError("invalid-argument", "invalid_request", "Invalid request fields or request exceeds 64 KiB.") from None

        access = self.services.matches.get_access(request.match_id)
        if not admin and actor.uid not in access.player_uids:
            raise ApiError("not-found", "not_found", "Match not found.")
        if request.game_mode != access.game_mode:
            raise ApiError("failed-precondition", "mode_mismatch", "Game mode does not match the assigned match.")
        if request.game_mode not in self.game_modes:
            raise ApiError("invalid-argument", "unsupported_mode", "Game mode is not configured for this API.")

        mid, mode = request.match_id, request.game_mode
        response = {"match_id": mid, "game_mode": mode}
        if operation == "submit_game":
            self.services.submissions.submit(mid, mode, actor.uid, request.submission)
            return {**response, "submitted": True}
        if operation == "get_submission_status":
            status = self.services.submissions.status(mid, mode, actor.uid)
            return {**response, "you_submitted": status.you_submitted,
                    "all_submitted": status.all_submitted}
        if operation == "get_game_result":
            result = self.services.evaluation.public_result(mid, mode)
            return {**response, "ready": result.ready,
                    "result": result.outcome if result.ready else None}
        if operation == "admin_inspect_game":
            info = self.services.admin.inspect(mid, mode)
            return {**response, "submitted_count": info.submitted_count,
                    "participant_count": info.participant_count,
                    "finalization_state": info.finalization_state}
        receipt = self.services.evaluation.request_finalization(
            mid, mode, actor.uid, request.idempotency_key)
        return {**response, "request_id": receipt.request_id, "state": receipt.state}
