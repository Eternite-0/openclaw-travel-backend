from __future__ import annotations

import json
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_FALLBACK_RATES: dict[str, float] = {
    "USD": 0.1382,
    "EUR": 0.1272,
    "GBP": 0.1089,
    "JPY": 20.85,
    "KRW": 186.5,
    "SGD": 0.1862,
    "AUD": 0.2103,
    "CAD": 0.1889,
    "HKD": 1.0810,
    "THB": 4.950,
    "MYR": 0.6490,
    "IDR": 2215.0,
    "VND": 3432.0,
    "INR": 11.52,
    "AED": 0.5075,
    "CHF": 0.1242,
    "NZD": 0.2286,
    "MXN": 2.376,
    "BRL": 0.692,
    "ZAR": 2.590,
    "TRY": 4.450,
    "RUB": 12.66,
}

_MEM_CACHE: dict[str, tuple[float, float]] = {}
_CACHE_TTL = 3600.0

_redis_client: Any | None = None


def set_redis_client(client: Any) -> None:
    global _redis_client
    _redis_client = client


async def _get_cached_rate(cache_key: str) -> float | None:
    import time

    if _redis_client is not None:
        try:
            raw = await _redis_client.get(cache_key)
            if raw:
                return float(raw)
        except Exception as exc:
            logger.warning("Redis cache read failed: %s", exc)

    if cache_key in _MEM_CACHE:
        rate, cached_at = _MEM_CACHE[cache_key]
        if time.time() - cached_at < _CACHE_TTL:
            return rate
    return None


async def _set_cached_rate(cache_key: str, rate: float) -> None:
    import time

    if _redis_client is not None:
        try:
            await _redis_client.set(cache_key, str(rate), ex=int(_CACHE_TTL))
            return
        except Exception as exc:
            logger.warning("Redis cache write failed: %s", exc)

    _MEM_CACHE[cache_key] = (rate, time.time())


async def get_rate(from_currency: str = "CNY", to_currency: str = "USD") -> float:
    """
    Fetch live exchange rate via exchangerate.host.
    Falls back to hardcoded approximate rates if the API fails.
    Result is cached in Redis (or in-memory) for 1 hour.
    """
    from_currency = from_currency.upper()
    to_currency = to_currency.upper()

    if from_currency == to_currency:
        return 1.0

    cache_key = f"rate:{from_currency}:{to_currency}"
    cached = await _get_cached_rate(cache_key)
    if cached is not None:
        logger.debug("Cache hit for %s → %s: %f", from_currency, to_currency, cached)
        return cached

    rate = await _fetch_rate_from_api(from_currency, to_currency)
    await _set_cached_rate(cache_key, rate)
    return rate


async def _fetch_rate_from_api(from_currency: str, to_currency: str) -> float:
    url = "https://api.exchangerate.host/convert"
    params = {"from": from_currency, "to": to_currency, "amount": 1}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data: dict[str, Any] = resp.json()
            rate = data.get("result") or data.get("info", {}).get("rate")
            if rate and float(rate) > 0:
                logger.info("Live rate %s → %s = %f", from_currency, to_currency, float(rate))
                return float(rate)
    except Exception as exc:
        logger.warning("exchangerate.host failed (%s), trying fallback", exc)

    return _fallback_rate(from_currency, to_currency)


def _fallback_rate(from_currency: str, to_currency: str) -> float:
    """
    Compute approximate rate via CNY as the pivot currency.
    CNY → X  = _FALLBACK_RATES[X]
    A → B    = _FALLBACK_RATES[B] / _FALLBACK_RATES[A]
    """
    if from_currency == "CNY":
        rate = _FALLBACK_RATES.get(to_currency, 0.14)
        logger.warning("Fallback rate CNY → %s = %f", to_currency, rate)
        return rate
    if to_currency == "CNY":
        cny_rate = _FALLBACK_RATES.get(from_currency, 0.14)
        rate = 1.0 / cny_rate if cny_rate else 7.24
        logger.warning("Fallback rate %s → CNY = %f", from_currency, rate)
        return rate

    from_cny = _FALLBACK_RATES.get(from_currency, 0.14)
    to_cny = _FALLBACK_RATES.get(to_currency, 0.14)
    rate = to_cny / from_cny if from_cny else 1.0
    logger.warning("Fallback rate %s → %s = %f", from_currency, to_currency, rate)
    return rate
