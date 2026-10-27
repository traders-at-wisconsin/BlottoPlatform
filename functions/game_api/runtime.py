"""Composition point: replace with team-owned adapters after coordination."""
import os
from datetime import timedelta
from functools import lru_cache

from .api import ApiError
from .round_api import RoundAPI, utc_now
from .round_mocks import MockCompetition, MockRound
from .lifecycle_mocks import MockLifecycleService
from .registration_mocks import MockRegistrationService


@lru_cache(maxsize=1)
def get_api() -> RoundAPI:
    # Fail closed. Mock data must never silently serve a deployed function.
    if os.environ.get("FUNCTIONS_EMULATOR") != "true" or os.environ.get("GAME_API_BACKEND") != "mock":
        raise ApiError("unavailable", "services_not_configured", "Team service adapters are not configured.")
    # Fixture only: fixed deadline from emulator process initialization, not reset
    # by submissions. Real rounds/config/deadlines come from the team's data layer.
    service = MockLifecycleService({"demo": MockCompetition(
        {"alice": True, "bob": True},
        {"round-1": MockRound(deadline=utc_now() + timedelta(hours=1))},
    )})
    registration = MockRegistrationService(service, {"demo": {"alice@example.test", "bob@example.test"}})
    return RoundAPI(service, admin_claim=os.environ.get("GAME_API_ADMIN_CLAIM", "admin"),
                    lifecycle_service=service, scoring_service=service,
                    registration_service=registration, player_registration_service=registration)
