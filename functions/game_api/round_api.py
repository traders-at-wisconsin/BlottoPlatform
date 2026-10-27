"""Phase 1 round-based API: validate and delegate; never score or publish."""
import json
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .api import Actor, ApiError, Identifier
from .contracts import ServiceError
from .round_contracts import AllocationConfig, RoundContext, RoundSubmissionService
from .round_contracts import RoundLifecycleService, RoundScoringService
from .lifecycle_api import OPERATIONS, handle_lifecycle
from .registration_api import handle_join
from .registration_contracts import RegistrationService, PlayerRegistrationService


class RoundRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    competition_id: Identifier
    round_id: Identifier


class AllocationRequest(RoundRequest):
    allocation: list[Annotated[int, Field(strict=True, ge=0)]]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def validate_allocation(allocation: list[int], config: AllocationConfig) -> None:
    """Shared with the data adapter for validation inside its atomic operation."""
    if (type(config.soldiers) is not int or config.soldiers < 0
            or type(config.battlefields) is not int or config.battlefields < 1
            or not config.game_mode or not config.version):
        raise ServiceError("invalid_configuration")
    if (len(allocation) != config.battlefields
            or any(type(value) is not int or value < 0 for value in allocation)
            or sum(allocation) != config.soldiers):
        raise ServiceError("invalid_allocation")


def require_eligible(context: RoundContext) -> None:
    # Same public error for unregistered and eliminated players.
    if not context.registered or not context.active:
        raise ServiceError("player_ineligible")


def require_open(context: RoundContext, now: datetime) -> None:
    if context.state != "open":
        raise ServiceError("round_not_open")
    if context.deadline.tzinfo is None or context.deadline.utcoffset() is None:
        raise ServiceError("invalid_configuration")
    if now >= context.deadline:
        raise ServiceError("deadline_passed")


ERRORS = {
    "registration_denied": ("permission-denied", "Registration is not permitted."),
    "not_found": ("not-found", "Competition or round not found."),
    "player_ineligible": ("permission-denied", "You are not eligible to participate in this competition."),
    "invalid_allocation": ("invalid-argument", "Allocation does not satisfy the round configuration."),
    "round_not_open": ("failed-precondition", "The round is not open for submissions."),
    "deadline_passed": ("failed-precondition", "The submission deadline has passed."),
    "configuration_changed": ("failed-precondition", "Round configuration changed; refresh and try again."),
    "conflict": ("aborted", "Concurrent update could not be completed; refresh round state before retrying."),
    "unavailable": ("unavailable", "The required service is unavailable."),
    "invalid_configuration": ("unavailable", "Round configuration is unavailable."),
    "invalid_deadline": ("invalid-argument", "Deadline must be in the future."),
    "deadline_not_reached": ("failed-precondition", "The submission deadline has not been reached."),
    "invalid_transition": ("failed-precondition", "The round cannot perform this transition."),
    "round_conflict": ("already-exists", "The round already exists with different parameters."),
    "scoring_incomplete": ("failed-precondition", "Scoring has not completed successfully."),
    "scoring_in_progress": ("failed-precondition", "Scoring is already in progress."),
    "rescore_required": ("failed-precondition", "Use an explicit rescore request for another scoring attempt."),
    "stale_revision": ("failed-precondition", "Scoring revision changed; refresh and try again."),
    "idempotency_conflict": ("already-exists", "The idempotency key was used for different parameters."),
    "publication_not_permitted": ("failed-precondition", "Publication is not permitted."),
}


class RoundAPI:
    def __init__(self, service: RoundSubmissionService,
                 clock: Callable[[], datetime] = utc_now, admin_claim: str = "admin",
                 lifecycle_service: RoundLifecycleService | None = None,
                 scoring_service: RoundScoringService | None = None,
                 registration_service: RegistrationService | None = None,
                 player_registration_service: PlayerRegistrationService | None = None):
        self.registration_service = registration_service
        self.player_registration_service = player_registration_service
        self.service, self.clock, self.admin_claim = service, clock, admin_claim
        self.lifecycle_service, self.scoring_service = lifecycle_service, scoring_service

    def call(self, operation: str, data: Any, actor: Actor | None) -> dict:
        try:
            return self._call(operation, data, actor)
        except ApiError:
            raise
        except ServiceError as exc:
            code, message = ERRORS.get(exc.reason, ("internal", "The operation could not be completed."))
            raise ApiError(code, exc.reason if exc.reason in ERRORS else "internal", message) from None
        except Exception:
            raise ApiError("internal", "internal", "The operation could not be completed.") from None

    def _call(self, operation: str, data: Any, actor: Actor | None) -> dict:
        if actor is None or not actor.uid:
            raise ApiError("unauthenticated", "authentication_required", "Sign in to continue.")
        if operation == "joinCompetition":
            return handle_join(self, data, actor)
        if operation in OPERATIONS:
            return handle_lifecycle(self, operation, data, actor)
        if operation.startswith("admin_") and actor.claims.get(self.admin_claim) is not True:
            raise ApiError("permission-denied", "admin_required", "Administrator access required.")
        if operation == "get_game_result":
            raise ApiError("failed-precondition", "direct_reads_required",
                           "Read published results through the team's Firestore read interface.")
        if operation == "admin_request_finalization":
            raise ApiError("failed-precondition", "round_lifecycle_deferred",
                           "Use the explicit admin round lifecycle callables instead.")
        models = {"submitAllocation": AllocationRequest, "submit_game": AllocationRequest,
                  "get_submission_status": RoundRequest, "admin_inspect_game": RoundRequest}
        model = models.get(operation)
        if model is None:
            raise ApiError("not-found", "unknown_operation", "Operation not found.")
        try:
            if len(json.dumps(data, allow_nan=False).encode("utf-8")) > 65536:
                raise ValueError("Request too large")
            request = model.model_validate(data)
        except (ValidationError, ValueError, TypeError, RecursionError):
            raise ApiError("invalid-argument", "invalid_request",
                           "Invalid request fields or request exceeds 64 KiB.") from None

        cid, rid = request.competition_id, request.round_id
        ref = {"competition_id": cid, "round_id": rid}
        if operation == "admin_inspect_game":
            info = self.service.inspect_round(cid, rid, actor.uid)
            return {**ref, "state": info.state, "deadline": info.deadline.isoformat(),
                    "game_mode": info.config.game_mode, "submitted_count": info.submitted_count}

        context = self.service.get_context(cid, rid, actor.uid)
        require_eligible(context)
        if operation == "get_submission_status":
            status = self.service.own_status(cid, rid, actor.uid)
            return {**ref, "submitted": status.submitted, "revision": status.revision,
                    "saved_at": status.saved_at.isoformat() if status.saved_at else None}

        require_open(context, self.clock())
        validate_allocation(request.allocation, context.config)
        receipt = self.service.replace_allocation(cid, rid, actor.uid,
                                                   request.allocation, context.config)
        return {**ref, "game_mode": context.config.game_mode, "submitted": True,
                "revision": receipt.revision, "saved_at": receipt.saved_at.isoformat()}
