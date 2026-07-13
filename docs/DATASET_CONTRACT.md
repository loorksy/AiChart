# Historical Dataset Contract

## Canonical bar

`research-service/app/data/` accepts normalized historical bars with required fields:

```text
timestamp open high low close volume spread symbol timeframe source
```

Optional fields are complete bid and ask OHLC groups, tick/real volume, and an IANA timezone.
`timestamp` is the UTC bar-open time. Prices use finite positive `Decimal` values; volume and
spread are finite and non-negative. OHLC relationships are validated independently for mid, bid,
and ask data, and bid cannot exceed ask at corresponding fields.

Supported timeframes are `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, and `1d`. Symbols normalize common
pair separators to a six-character uppercase Forex/XAUUSD form. Dataset validation itself checks
shape, not the strategy symbol metadata registry; the engine performs the supported-metadata gate.

## Timezone and DST policy

- Offset-aware timestamps are converted to UTC.
- A naive timestamp is rejected unless an IANA timezone is supplied.
- A nonexistent local timestamp at a DST spring transition is rejected.
- An ambiguous local timestamp at a DST fall transition is rejected unless the input carries an
  explicit UTC offset.
- The original timezone label may be retained as metadata; internal ordering and hashing use UTC.

No timestamp timezone is silently stripped or guessed.

## Ordering, sources, gaps, and limits

Bars must be strictly increasing for every symbol/timeframe series. Duplicate timestamps and
mixed sources are rejected. A configured run end rejects later bar-open timestamps. Limits bound
rows, bytes, symbols, date range, and Parquet batch size; current defaults are 250,000 rows, 32 MiB,
20 symbols, and 3,660 days.

The quality report records row count, start/end, duplicates, invalid rows, missing intervals,
largest gap, spread/volume coverage, source, and dataset hash. Because invalid/duplicate rows fail
closed, successful reports currently show zero for those counters.

Gap detection compares adjacent UTC opens to nominal timeframe duration. It is not yet aware of
Forex weekends, holidays, or early closes, so weekend closures are reported as gaps rather than
classified calendar closures. Consumers must not interpret every gap as a provider defect.

There is no silent sorting, duplicate resolution, row dropping, resampling, source fallback, or
gap filling.

## Stable hash

The dataset hash is SHA-256 over normalized bars ordered by symbol, timeframe, and timestamp.
Decimals receive a canonical non-exponent representation and timestamps use UTC microsecond ISO
format. Optional fields and source identity participate in the hash. Input object/key order does
not affect the result.

## CSV loader

CSV must be UTF-8 with a unique header. Without a mapping, only canonical columns are accepted.
With an explicit mapping, canonical destinations and source columns must be unique and every
required canonical field must be present. Malformed rows, locale decimal commas, unknown fields,
and size/row overruns fail the entire load.

## Parquet loader

Parquet accepts only bounded scalar string, integer, floating, decimal, and timestamp columns.
Nested types are rejected; batches are read deterministically without worker threads. Paths pass
the same controlled-root checks as CSV.

PyArrow is imported only on the Parquet path and is pinned in
`research-service/pyproject.toml`. If a deployment is incomplete and PyArrow is unavailable, the
loader returns a specific dependency-unavailable error rather than falling back. The pinned wheel
passes the Parquet loader test in an isolated Python 3.12 environment, matching the service image's
Python line. Container validation remains pending because Docker is unavailable on the current
host.

## Controlled files and no arbitrary I/O

The file registry accepts `pathlib.Path` objects only beneath an authorized artifact root. It
rejects URLs, `file:` URIs, traversal, absolute/root escape, symlinks, wrong suffixes, missing files,
and oversize files. Loader selection is a closed enum and never imports a user module. No loader
performs HTTP or accesses AiChart's database.

## AiChart Candle Warehouse export

The consumer contract is `aichart-candle-warehouse-v1`:

```json
{
  "schema_version": "aichart-candle-warehouse-v1",
  "source": "aichart_candle_warehouse",
  "exported_at": "2026-07-13T10:00:00Z",
  "closed_bars_only": true,
  "bars": []
}
```

Every row must carry `is_closed: true`, match the envelope source, and have a close time no later
than `exported_at`. The loader is an in-memory, bounded JSON consumer and opens no DB/network path.

AiChart now has a server-only producer in `web/src/lib/research/warehouse.ts`. It requires the
service/backtest flags, allowlists symbol/timeframe, caps export to 10,000 rows and ten years,
queries the warehouse in the web process, filters `complete=true`, revalidates OHLC/order/range,
and rejects a bar whose computed close exceeds export time.

The TypeScript and Python job contracts now share a strict discriminated union. A dataset is either
an artifact reference containing `source: "artifact"`, tenant-owned source `job_id`, `artifact_id`,
format, and optional column mapping, or an inline value containing
`source: "aichart_candle_warehouse"` and the validated envelope. Artifact references are resolved
through the tenant-scoped Research Service artifact store; they are not arbitrary paths.

The service and server-only TypeScript client permit at most 8 MiB for a complete Phase 3 request,
further reduced by configured dataset limits; strategy specifications retain their separate
48 KiB bound. No truncation occurs. A regression pipeline sends a 400-bar warehouse envelope above
48 KiB through dataset validation, strategy validation, backtest, statistical validation,
readiness, and artifacts. Exports larger than 8 MiB fail before submission and require an explicit
future artifact-ingest design; Research Service never receives AiChart production database
credentials as a workaround.

## Multi-timeframe availability

`ClosedBarAligner` computes close time as bar open plus timeframe duration and returns only the
last bar whose close is `<= available_at`. At an exact close boundary, that bar becomes available.
This is the required point-in-time rule for higher-timeframe conditions. It does not resample
missing higher-timeframe data; a missing series remains missing.
