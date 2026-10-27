"""Validate verified identity and delegate registration; never define Firestore paths."""
import json
import unicodedata

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .api import ApiError, Identifier


class JoinRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    competition_id: Identifier
    display_name: str = Field(min_length=1, max_length=80)

    @field_validator("display_name")
    @classmethod
    def clean_name(cls, value):
        if not value.strip() or any(unicodedata.category(c).startswith("C") for c in value):
            raise ValueError("Invalid display name")
        return value.strip()


def handle_join(api, data, actor):
    email = actor.claims.get("email")
    if (actor.claims.get("email_verified") is not True or not isinstance(email, str)
            or not email or email != email.strip() or "@" not in email):
        raise ApiError("permission-denied", "verified_email_required", "A verified email is required.")
    try:
        if len(json.dumps(data, allow_nan=False).encode("utf-8")) > 65536:
            raise ValueError("Request too large")
        request = JoinRequest.model_validate(data)
    except (ValidationError, ValueError, TypeError, RecursionError):
        raise ApiError("invalid-argument", "invalid_request", "Invalid registration request.") from None
    if api.registration_service is None or api.player_registration_service is None:
        raise ApiError("unavailable", "services_not_configured", "Registration services are not configured.")
    grant = api.registration_service.authorize(request.competition_id, actor.uid, email)
    # Fail closed if an adapter returns a grant for a different identity.
    if (grant.competition_id, grant.uid, grant.email) != (request.competition_id, actor.uid, email):
        raise ApiError("internal", "internal", "The operation could not be completed.")
    api.player_registration_service.ensure_player(grant, request.display_name)
    return {"competition_id": request.competition_id, "registered": True}
