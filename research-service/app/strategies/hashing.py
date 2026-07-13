import hashlib

from .canonical import canonical_strategy_json
from .schema import StrategySpecification


def strategy_spec_hash(specification: StrategySpecification) -> str:
    payload = canonical_strategy_json(specification).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()
