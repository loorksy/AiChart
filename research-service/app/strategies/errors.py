"""Domain errors for strict, non-executable strategy specifications."""


class StrategyError(ValueError):
    """Base error raised by the strategy boundary."""


class StrategyValidationError(StrategyError):
    """Raised when a strategy specification is invalid or unsupported."""


class StrategyCompileError(StrategyError):
    """Raised when validated strategy metadata cannot be compiled."""


class StrategyStoreConflictError(StrategyError):
    """Raised when an immutable strategy identity would be overwritten."""
