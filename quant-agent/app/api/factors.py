"""The factor-library endpoints: `GET /internal/quant-agent/factors` (the
catalogue), `GET .../factors/{factor_id}` (one definition) and
`POST .../factors/compute` (one factor over pushed-in bars).

All three are pure functions over data `web/` supplies — no store, no network.
Upstream reads its own market database inside the strategy runtime that calls
`compute_factor`; this service has no egress, so the candles ride in on the
request, the same push-not-pull shape `app/api/backtests.py` already uses.

Error convention follows `app/api/recommendations.py` rather than
`app/api/strategies.py`: this is a data endpoint, so an unknown factor is a 404
and an uncomputable request is a 422 with a code — not a 200 carrying
`status="invalid"`. Upstream's own `FactorError` code travels in the message so
a client can key its i18n off `factor.insufficientHistory` exactly as the Vue
factor library does.

Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Sources:
`backend_api_python/app/routes/factors.py` and
`.../app/routes/agent_v1/research.py`. Changed on port: Flask to FastAPI, the
two divergent upstream envelopes (`{code, msg, data}` for humans and
`{code, message, data}` for agents) collapse to this service's single
`{"error": {"code", "message"}}` shape, and the TA-Lib merge is replaced by the
permanently-degraded `talib_available: false` that upstream itself falls back
to when the extension is missing.
"""

from __future__ import annotations

import math

from fastapi import APIRouter, Depends, Query

from app.engine.factors.frame import FactorError
from app.engine.factors.models import (
    FactorCatalogueMeta,
    FactorComputeRequest,
    FactorComputeResponse,
    FactorListResponse,
    FactorMetadata,
    build_frame,
)
from app.engine.factors.registry import (
    all_factors,
    compute_factor,
    factor_count,
    get_factor,
    list_factors,
)
from app.errors import ServiceError
from app.security import require_internal_auth

router = APIRouter(prefix="/internal/quant-agent/factors", tags=["quant-agent-factors"])

_AUTH = Depends(require_internal_auth)

# Upstream returns bare codes; each gets one line of English here so an
# operator reading a log does not have to open the registry to decode it. The
# code itself is always the prefix, and it is the part clients should match on.
_FACTOR_ERROR_MESSAGES: dict[str, str] = {
    "factor.notFound": "no factor is registered with that id",
    "factor.talibUnavailable": (
        "TA-Lib factors are not available in this service; only the built-in registry is"
    ),
    "factor.noData": "no rows were supplied to compute over",
    "factor.missingFields": "the supplied rows are missing a column this factor requires",
    "factor.insufficientHistory": "not enough history for the requested period",
    "factor.invalidParameter": "a supplied parameter is outside its allowed range",
    "factor.computeFailed": "the factor could not be computed from the supplied rows",
}

_NOT_FOUND_CODES = frozenset({"factor.notFound", "factor.talibUnavailable"})


def _service_error(exc: FactorError) -> ServiceError:
    detail = _FACTOR_ERROR_MESSAGES.get(exc.code, "the factor request could not be served")
    if exc.code in _NOT_FOUND_CODES:
        return ServiceError("QUANT_AGENT_NOT_FOUND", f"{exc.code}: {detail}", 404)
    return ServiceError("QUANT_AGENT_INPUT_INVALID", f"{exc.code}: {detail}", 422)


def _catalogue_meta(returned: int) -> FactorCatalogueMeta:
    available = sum(1 for definition in all_factors() if definition.availability == "available")
    total = factor_count()
    return FactorCatalogueMeta(
        builtin_count=total,
        returned_count=returned,
        available_count=available,
        unavailable_count=total - available,
    )


@router.get(
    "",
    response_model=FactorListResponse,
    response_model_exclude_none=True,
    dependencies=[_AUTH],
)
async def list_factor_catalogue(
    category: str = Query(default="", max_length=40),
    factor_type: str = Query(default="", max_length=40),
) -> FactorListResponse:
    """The catalogue, optionally filtered. Both filters are exact-match strings
    and an empty one means "no filter", exactly as upstream reads them; an
    unknown value simply returns an empty list rather than a 400."""
    items = [FactorMetadata.model_validate(item) for item in list_factors(
        category=category.strip(), factor_type=factor_type.strip()
    )]
    return FactorListResponse(items=items, meta=_catalogue_meta(len(items)))


@router.post("/compute", response_model=FactorComputeResponse, dependencies=[_AUTH])
async def compute_one_factor(body: FactorComputeRequest) -> FactorComputeResponse:
    """One factor, over the pushed-in rows, at the LAST row only.

    A NaN result is not an error: it means this factor has no defined value for
    these bars (a degenerate band, an untraded session). It comes back as
    `value: null, is_nan: true` so the caller reports it as absent instead of
    rendering a zero.
    """
    try:
        definition = get_factor(body.factor_id)
        frame = build_frame(body.bars, body.fundamentals)
        value = compute_factor(body.factor_id, frame, body.params)
    except FactorError as exc:
        raise _service_error(exc) from exc

    is_nan = not math.isfinite(value)
    return FactorComputeResponse(
        factor_id=definition.factor_id,
        version=definition.version,
        value=None if is_nan else value,
        is_nan=is_nan,
        params_used={**definition.default_params, **body.params},
        row_count=frame.row_count,
    )


@router.get(
    "/{factor_id}",
    response_model=FactorMetadata,
    response_model_exclude_none=True,
    dependencies=[_AUTH],
)
async def get_factor_definition(factor_id: str) -> FactorMetadata:
    try:
        definition = get_factor(factor_id)
    except FactorError as exc:
        raise _service_error(exc) from exc
    return FactorMetadata.model_validate(definition.metadata())
