"""Cloud Functions entry point.

The callables (joinCompetition, submitAllocation, admin.openRound / closeRound /
scoreRound / publishRound) belong to the backend API component. They call
repo.py for every read and write, and map errors.py to HttpsError codes:

    ValidationError -> INVALID_ARGUMENT     ConflictError  -> FAILED_PRECONDITION
    NotFoundError   -> NOT_FOUND            ForbiddenError -> PERMISSION_DENIED

Use repo.client() for the Firestore client; it handles the emulator.
"""

from firebase_admin import initialize_app

initialize_app()
