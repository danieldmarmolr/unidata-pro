"""
Metodos de forecast en Python puro (sin numpy/statsmodels) para series diarias
de ganancia. Cada metodo devuelve {forecast: list[float], name: str, params: dict}.

Implementados:
- naive_last: ultima observacion repetida (baseline)
- naive_mean7: promedio de los ultimos 7 dias repetido (baseline simple)
- linear_regression: regresion lineal least squares + banda confianza ±1 stddev
- weighted_ma: media movil ponderada con decay exponencial
- ema (single exponential smoothing): suavizado exponencial sin trend
- holt: doble exponencial (level + trend, Holt 1957)
- holt_winters_additive: triple exponencial con estacionalidad semanal aditiva
- holt_winters_multiplicative: triple exponencial con estacionalidad semanal multiplicativa

MAPE (Mean Absolute Percentage Error) calculado via backtest train/test split.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable


@dataclass
class ForecastResult:
    name: str
    label: str                  # legible
    forecast: list[float]       # valores predichos forward
    mape_pct: float | None      # error backtest, None si no se pudo calcular
    in_sample_rmse: float | None  # error sobre el ajuste, opcional
    params: dict = field(default_factory=dict)
    # Para metodos con banda de confianza: stddev del error in-sample (escala absoluta)
    sigma: float | None = None

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "label": self.label,
            "forecast": [round(v, 2) for v in self.forecast],
            "mape_pct": round(self.mape_pct, 2) if self.mape_pct is not None else None,
            "in_sample_rmse": round(self.in_sample_rmse, 2) if self.in_sample_rmse is not None else None,
            "sigma": round(self.sigma, 2) if self.sigma is not None else None,
            "params": self.params,
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mape(actual: list[float], predicted: list[float]) -> float | None:
    """Mean Absolute Percentage Error. Skipea valores con actual=0 para evitar div/0."""
    pairs = [(a, p) for a, p in zip(actual, predicted) if a != 0]
    if not pairs:
        return None
    return sum(abs((a - p) / a) for a, p in pairs) / len(pairs) * 100


def _rmse(actual: list[float], predicted: list[float]) -> float | None:
    if not actual or not predicted:
        return None
    n = min(len(actual), len(predicted))
    if n == 0:
        return None
    return math.sqrt(sum((actual[i] - predicted[i]) ** 2 for i in range(n)) / n)


def _stddev(values: list[float]) -> float:
    """Sample stddev (Bessel-corrected) — usa N-1."""
    n = len(values)
    if n < 2:
        return 0.0
    mean = sum(values) / n
    return math.sqrt(sum((v - mean) ** 2 for v in values) / (n - 1))


# ---------------------------------------------------------------------------
# Naive baselines
# ---------------------------------------------------------------------------

def naive_last(values: list[float], horizon: int) -> tuple[list[float], list[float]]:
    """Repite el ultimo valor. Devuelve (in_sample_fit, forecast)."""
    if not values:
        return [], [0.0] * horizon
    last = values[-1]
    # fit: predice cada t como values[t-1]
    fit = [values[0]] + values[:-1]
    return fit, [last] * horizon


def naive_mean7(values: list[float], horizon: int) -> tuple[list[float], list[float]]:
    """Predice cada periodo como promedio de los ultimos 7."""
    if not values:
        return [], [0.0] * horizon
    window = values[-7:] if len(values) >= 7 else values
    avg = sum(window) / len(window)
    fit = []
    for i in range(len(values)):
        w = values[max(0, i - 7): i]
        fit.append(sum(w) / len(w) if w else values[0])
    return fit, [avg] * horizon


# ---------------------------------------------------------------------------
# Linear regression (least squares) con banda de confianza
# ---------------------------------------------------------------------------

def linear_regression(values: list[float], horizon: int) -> tuple[list[float], list[float], float, float, float]:
    """OLS: y = a + b*t. Devuelve (fit, forecast, slope, intercept, sigma_resid)."""
    n = len(values)
    if n < 2:
        return values, [values[-1] if values else 0] * horizon, 0.0, values[-1] if values else 0, 0.0
    xs = list(range(n))
    mean_x = sum(xs) / n
    mean_y = sum(values) / n
    num = sum((xs[i] - mean_x) * (values[i] - mean_y) for i in range(n))
    den = sum((xs[i] - mean_x) ** 2 for i in range(n))
    slope = num / den if den != 0 else 0.0
    intercept = mean_y - slope * mean_x
    fit = [intercept + slope * t for t in xs]
    forecast = [intercept + slope * (n + h) for h in range(horizon)]
    residuals = [values[i] - fit[i] for i in range(n)]
    sigma = _stddev(residuals)
    return fit, forecast, slope, intercept, sigma


# ---------------------------------------------------------------------------
# Weighted moving average con decay
# ---------------------------------------------------------------------------

def weighted_ma(values: list[float], horizon: int, window: int = 14, decay: float = 0.85) -> tuple[list[float], list[float]]:
    """WMA con peso decay^k. window=14 dias por default."""
    if not values:
        return [], [0.0] * horizon
    weights = [decay ** k for k in range(window)]
    sum_w = sum(weights)

    def _w_avg(buffer: list[float]) -> float:
        if not buffer:
            return 0.0
        used = buffer[-window:]
        ws = weights[:len(used)]
        return sum(used[i] * ws[len(used) - 1 - i] for i in range(len(used))) / sum(ws)

    fit = []
    for i in range(len(values)):
        fit.append(_w_avg(values[:i]) if i > 0 else values[0])
    forecast_val = _w_avg(values)
    return fit, [forecast_val] * horizon


# ---------------------------------------------------------------------------
# Exponential smoothing (single, double = Holt, triple = Holt-Winters)
# ---------------------------------------------------------------------------

def ema(values: list[float], horizon: int, alpha: float = 0.3) -> tuple[list[float], list[float]]:
    """Single exponential smoothing (Brown). Sin trend, sin estacionalidad."""
    if not values:
        return [], [0.0] * horizon
    s = values[0]
    fit = [s]
    for v in values[1:]:
        s = alpha * v + (1 - alpha) * s
        fit.append(s)
    return fit, [s] * horizon


def holt(values: list[float], horizon: int, alpha: float = 0.3, beta: float = 0.1) -> tuple[list[float], list[float]]:
    """Double exponential smoothing (Holt 1957). Captura level + trend lineal."""
    if len(values) < 2:
        return values, [values[-1] if values else 0] * horizon
    level = values[0]
    trend = values[1] - values[0]
    fit = [level]
    for t in range(1, len(values)):
        prev_level = level
        level = alpha * values[t] + (1 - alpha) * (level + trend)
        trend = beta * (level - prev_level) + (1 - beta) * trend
        fit.append(level)
    forecast = [level + (h + 1) * trend for h in range(horizon)]
    return fit, forecast


def _detect_season_length(values: list[float], default: int = 7) -> int:
    """Por simplicidad asumimos estacionalidad semanal (7 dias)."""
    return default if len(values) >= 2 * default else 0


def holt_winters_additive(values: list[float], horizon: int,
                           alpha: float = 0.3, beta: float = 0.1, gamma: float = 0.2,
                           season_length: int = 7) -> tuple[list[float], list[float]]:
    """Triple exponential smoothing aditivo (Holt-Winters). Estacionalidad SUMADA."""
    L = season_length
    if len(values) < 2 * L:
        # Fallback a Holt si no hay suficiente data para seasonal
        return holt(values, horizon, alpha, beta)

    # Init: usar primeras 2 estaciones para level/trend, season components iniciales
    s1 = values[:L]
    s2 = values[L:2 * L]
    level = sum(s1) / L
    trend = (sum(s2) / L - sum(s1) / L) / L
    seasonals = [s1[i] - level for i in range(L)]

    fit = []
    for t in range(len(values)):
        if t < L:
            fit.append(level + seasonals[t % L])
            continue
        prev_level = level
        s_idx = (t - L) % L
        level = alpha * (values[t] - seasonals[s_idx]) + (1 - alpha) * (level + trend)
        trend = beta * (level - prev_level) + (1 - beta) * trend
        seasonals[s_idx] = gamma * (values[t] - level) + (1 - gamma) * seasonals[s_idx]
        fit.append(level + seasonals[s_idx])

    forecast = []
    for h in range(horizon):
        s_idx = (len(values) + h - L) % L
        forecast.append(level + (h + 1) * trend + seasonals[s_idx])
    return fit, forecast


def holt_winters_multiplicative(values: list[float], horizon: int,
                                 alpha: float = 0.3, beta: float = 0.1, gamma: float = 0.2,
                                 season_length: int = 7) -> tuple[list[float], list[float]]:
    """Triple exponential smoothing multiplicativo. Estacionalidad MULTIPLICADA.
    Requiere todos los valores >0 (si no, fallback a aditivo)."""
    L = season_length
    if len(values) < 2 * L or any(v <= 0 for v in values[:2 * L]):
        return holt_winters_additive(values, horizon, alpha, beta, gamma, L)

    s1 = values[:L]
    s2 = values[L:2 * L]
    m1 = sum(s1) / L
    m2 = sum(s2) / L
    level = m1
    trend = (m2 - m1) / L
    seasonals = [s1[i] / m1 if m1 > 0 else 1.0 for i in range(L)]

    fit = []
    for t in range(len(values)):
        if t < L:
            fit.append((level + trend) * seasonals[t % L])
            continue
        prev_level = level
        s_idx = (t - L) % L
        if seasonals[s_idx] == 0:
            seasonals[s_idx] = 1.0
        level = alpha * (values[t] / seasonals[s_idx]) + (1 - alpha) * (level + trend)
        trend = beta * (level - prev_level) + (1 - beta) * trend
        if level != 0:
            seasonals[s_idx] = gamma * (values[t] / level) + (1 - gamma) * seasonals[s_idx]
        fit.append(level * seasonals[s_idx])

    forecast = []
    for h in range(horizon):
        s_idx = (len(values) + h - L) % L
        forecast.append((level + (h + 1) * trend) * seasonals[s_idx])
    return fit, forecast


# ---------------------------------------------------------------------------
# Comparison orchestrator with MAPE backtest
# ---------------------------------------------------------------------------

def _backtest_mape(
    fn: Callable[[list[float], int], tuple[list[float], list[float]]],
    values: list[float],
    test_size: int,
) -> float | None:
    """Reserva ultimos test_size dias como hold-out. Entrena con el resto, MAPE."""
    if len(values) < test_size + 14:
        return None
    train = values[:-test_size]
    test = values[-test_size:]
    _, fc = fn(train, test_size)
    return _mape(test, fc)


def compare_forecasts(values: list[float], horizon: int = 28, backtest_size: int = 14) -> dict:
    """Aplica todos los metodos sobre `values`, hace backtest para MAPE,
    devuelve forecasts + MAPE + cual es el ganador.

    horizon: dias a predecir forward
    backtest_size: dias del final reservados para validar (default 14)
    """
    if len(values) < 14:
        return {"results": [], "winner": None, "horizon": horizon, "history_n": len(values)}

    methods: list[tuple[str, str, Callable]] = [
        ("naive_last",      "Naive (ultimo valor)",        lambda v, h: naive_last(v, h)),
        ("naive_mean7",     "Naive (media 7d)",            lambda v, h: naive_mean7(v, h)),
        ("linear",          "Regresion lineal",            lambda v, h: linear_regression(v, h)[:2]),
        ("wma",             "Media movil ponderada 14d",   lambda v, h: weighted_ma(v, h)),
        ("ema",             "EMA (single exp smoothing)",  lambda v, h: ema(v, h)),
        ("holt",            "Holt (level+trend)",          lambda v, h: holt(v, h)),
        ("hw_additive",     "Holt-Winters aditivo (7d)",   lambda v, h: holt_winters_additive(v, h)),
        ("hw_multiplicative","Holt-Winters multiplicativo (7d)", lambda v, h: holt_winters_multiplicative(v, h)),
    ]

    results: list[ForecastResult] = []
    for name, label, fn in methods:
        try:
            fit, fc = fn(values, horizon)
            mape = _backtest_mape(fn, values, backtest_size)
            rmse = _rmse(values, fit)
            sigma = _stddev([values[i] - fit[i] for i in range(min(len(values), len(fit)))]) if fit else None
            results.append(ForecastResult(
                name=name, label=label, forecast=fc, mape_pct=mape,
                in_sample_rmse=rmse, sigma=sigma,
            ))
        except Exception as exc:
            # Si un metodo falla (data insuficiente, etc), lo skipeamos sin tumbar todo
            import logging
            logging.getLogger("unidata.forecast").warning("forecast %s fallo: %s", name, exc)

    # Ganador = menor MAPE entre los que tengan MAPE calculado
    with_mape = [r for r in results if r.mape_pct is not None]
    winner = min(with_mape, key=lambda r: r.mape_pct).name if with_mape else None

    return {
        "horizon": horizon,
        "backtest_size": backtest_size,
        "history_n": len(values),
        "results": [r.to_dict() for r in results],
        "winner": winner,
    }
