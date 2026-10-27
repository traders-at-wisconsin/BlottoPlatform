"""Registration interfaces, not database schemas or client-supplied credentials."""
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class RegistrationGrant:
    competition_id: str
    uid: str
    email: str


class RegistrationService(Protocol):
    def authorize(self, competition_id: str, uid: str, email: str) -> RegistrationGrant:
        """Check authoritative competition/allowlist and identity binding.

        Email is from a verified Firebase token. Missing/denied entries raise
        registration_denied; no player write may occur on denial.
        """
        ...


class PlayerRegistrationService(Protocol):
    def ensure_player(self, grant: RegistrationGrant, display_name: str) -> None:
        """Atomically create once, keyed by competition and verified UID.

        Recheck allowlist and identity binding in the same transaction/workflow
        guard as creation (a grant alone is not durable authorization). Bind one
        allowlisted email to one UID. Existing members return success without
        renaming, reactivating eliminated players, or resetting tournament state.
        Concurrent duplicates must have one creation effect. Unknown competition
        raises not_found; denied/revoked/rebound identity raises registration_denied.
        Real adapters own registration-open policy, canonical email mapping, schema,
        audit, and durable retry behavior. No external side effects in retry callbacks.
        """
        ...
