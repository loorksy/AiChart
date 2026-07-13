from __future__ import annotations


class DatasetError(ValueError):
    """Base class for safe, user-correctable dataset failures."""


class DatasetInputError(DatasetError):
    """The dataset content or schema is invalid."""


class DatasetLimitError(DatasetError):
    """A configured dataset resource limit was exceeded."""


class DatasetPathError(DatasetError):
    """A dataset path was outside the authorized artifact root."""


class DatasetDependencyUnavailable(DatasetError):
    """An optional, pinned file-format dependency is unavailable."""
