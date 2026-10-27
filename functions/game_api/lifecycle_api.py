"""Admin-only lifecycle request models and delegation, without game algorithms."""
import json
from datetime import datetime, timezone
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from .api import ApiError, Identifier
from .contracts import ServiceError


OPERATIONS = frozenset({"openRound", "closeRound", "scoreRound", "publishRound"})


class LifecycleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    competition_id: Identifier
    round_number: Annotated[int, Field(strict=True, ge=1)]


class OpenRequest(LifecycleRequest):
    deadline: str

    @field_validator("deadline")
    @classmethod
    def valid_deadline(cls, value):
        parse_deadline(value)
        return value


def parse_deadline(value: str) -> datetime:
    # JSON carries ISO 8601 strings, never a browser timestamp or naive datetime.
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("Timezone required")
    return parsed.astimezone(timezone.utc)


class ScoreRequest(LifecycleRequest):
    idempotency_key: Identifier
    rescore: bool = False
    expected_scoring_revision: Annotated[int, Field(strict=True, ge=1)] | None = None

    @model_validator(mode="after")
    def explicit_rescore(self):
        if self.rescore != (self.expected_scoring_revision is not None):
            raise ValueError("Rescore requires expected revision; initial scoring must omit it")
        return self


class PublishRequest(LifecycleRequest):
    expected_scoring_revision: Annotated[int, Field(strict=True, ge=1)]


def handle_lifecycle(api, operation, data, actor):
    if actor.claims.get(api.admin_claim) is not True:
        raise ApiError("permission-denied", "admin_required", "Administrator access required.")
    models = {"openRound": OpenRequest, "closeRound": LifecycleRequest,
              "scoreRound": ScoreRequest, "publishRound": PublishRequest}
    try:
        if len(json.dumps(data, allow_nan=False).encode("utf-8")) > 65536:
            raise ValueError("Request too large")
        request = models[operation].model_validate(data)
    except (ValidationError, ValueError, TypeError, RecursionError):
        raise ApiError("invalid-argument", "invalid_request", "Invalid lifecycle request fields.") from None
    if api.lifecycle_service is None:
        raise ServiceError("unavailable")
    service = api.lifecycle_service
    cid, number = request.competition_id, request.round_number
    if operation == "openRound":
        # Service checks fresh time atomically; expired-deadline retries of an
        # existing identical round must still be idempotent, not rejected here.
        info = service.open_round(cid, number, parse_deadline(request.deadline), actor.uid)
    else:
        info = service.lifecycle_status(cid, number, actor.uid)
        if operation == "closeRound":
            if info.state == "open" and api.clock() < info.deadline:
                raise ServiceError("deadline_not_reached")
            info = service.close_round(cid, number, actor.uid)
        elif operation == "scoreRound":
            if info.state not in {"closed", "scored"}:
                raise ServiceError("invalid_transition")
            if api.scoring_service is None:
                raise ServiceError("unavailable")
            info = api.scoring_service.request_scoring(
                cid, number, request.idempotency_key, request.rescore,
                request.expected_scoring_revision, actor.uid)
        else:
            if info.state not in {"scored", "published"} or info.scoring_status != "completed":
                raise ServiceError("scoring_incomplete")
            info = service.publish_round(cid, number, request.expected_scoring_revision, actor.uid)
    # Explicit projection, never serialize a service object's full __dict__.
    return {"competition_id": cid, "round_id": info.round_id, "round_number": info.round_number,
            "state": info.state, "deadline": info.deadline.isoformat(),
            "scoring_revision": info.scoring_revision, "scoring_status": info.scoring_status}
