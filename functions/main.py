"""Submission and admin lifecycle callables. Game algorithms stay in team services."""
from firebase_functions import https_fn

if __package__:
    from .game_api.api import Actor, ApiError
    from .game_api.runtime import get_api
else:  # Firebase loads main.py from the configured Functions source directory.
    from game_api.api import Actor, ApiError
    from game_api.runtime import get_api


def dispatch(operation: str, request: https_fn.CallableRequest):
    try:
        # request.auth is populated by the Firebase callable wrapper, never data.
        if request.auth is None or not request.auth.uid:
            raise ApiError("unauthenticated", "authentication_required", "Sign in to continue.")
        actor = Actor(request.auth.uid, request.auth.token)
        return get_api().call(operation, request.data, actor)
    except ApiError as exc:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode(exc.code),
            message=exc.message,
            details={"reason": exc.reason},
        ) from None
    except Exception:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message="The operation could not be completed.",
            details={"reason": "internal"},
        ) from None


@https_fn.on_call()
def submitAllocation(request: https_fn.CallableRequest):
    return dispatch("submitAllocation", request)


@https_fn.on_call()
def submit_game(request: https_fn.CallableRequest):
    """Deprecated alias: accepts the same round-based request as submitAllocation."""
    return dispatch("submit_game", request)


@https_fn.on_call()
def get_submission_status(request: https_fn.CallableRequest):
    return dispatch("get_submission_status", request)


@https_fn.on_call()
def get_game_result(request: https_fn.CallableRequest):
    """Deprecated migration stub: published results are read directly in Firestore."""
    return dispatch("get_game_result", request)


@https_fn.on_call()
def admin_inspect_game(request: https_fn.CallableRequest):
    return dispatch("admin_inspect_game", request)


@https_fn.on_call()
def admin_request_finalization(request: https_fn.CallableRequest):
    """Deprecated migration stub: use the explicit admin lifecycle functions."""
    return dispatch("admin_request_finalization", request)


@https_fn.on_call()
def openRound(request: https_fn.CallableRequest):
    return dispatch("openRound", request)


@https_fn.on_call()
def closeRound(request: https_fn.CallableRequest):
    return dispatch("closeRound", request)


@https_fn.on_call()
def scoreRound(request: https_fn.CallableRequest):
    return dispatch("scoreRound", request)


@https_fn.on_call()
def publishRound(request: https_fn.CallableRequest):
    return dispatch("publishRound", request)


@https_fn.on_call()
def joinCompetition(request: https_fn.CallableRequest):
    return dispatch("joinCompetition", request)
