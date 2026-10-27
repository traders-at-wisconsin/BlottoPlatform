"""Errors the data layer raises; the backend maps each to an HttpsError code."""


class BlottoError(Exception):
    """Base class for expected, caller-facing errors."""


class ValidationError(BlottoError):
    """Input has the wrong shape or breaks a game rule. -> INVALID_ARGUMENT"""


class ConflictError(BlottoError):
    """The request clashes with current state, e.g. the round is not open. -> FAILED_PRECONDITION"""


class NotFoundError(BlottoError):
    """A referenced document does not exist. -> NOT_FOUND"""


class ForbiddenError(BlottoError):
    """The caller may not do this, e.g. an email that is not registered. -> PERMISSION_DENIED"""
