"""Versioned factor registry and deterministic computation helpers.

The public surface mirrors QuantDinger's
`backend_api_python/app/services/factors/__init__.py`
(https://github.com/OpenByteInc/QuantDinger, Copyright Open Byte Inc.,
Apache-2.0, http://www.apache.org/licenses/LICENSE-2.0), minus
`talib_adapter` — the TA-Lib C extension is not installed in this service and
reimplementing its catalogue is out of scope. `app/api/factors.py` keeps
upstream's degraded contract (`talib_available: false`) so a client written
against QuantDinger behaves the same here as it does there without TA-Lib.
"""

from app.engine.factors.frame import FactorError, Frame
from app.engine.factors.registry import (
    FactorDefinition,
    all_factors,
    compute_factor,
    compute_panel_factor,
    factor_count,
    factor_ids,
    get_factor,
    list_factors,
)

__all__ = [
    "FactorDefinition",
    "FactorError",
    "Frame",
    "all_factors",
    "compute_factor",
    "compute_panel_factor",
    "factor_count",
    "factor_ids",
    "get_factor",
    "list_factors",
]
