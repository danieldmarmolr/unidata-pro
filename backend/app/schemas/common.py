"""Schemas Pydantic compartidos."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: str


class TableInfo(BaseModel):
    schema_: str = Field(alias="schema")
    table_name: str
    approx_rows: int
    size_bytes: int
    size_pretty: str

    model_config = {"populate_by_name": True}


class ColumnInfo(BaseModel):
    column_name: str
    data_type: str
    is_nullable: str
    column_default: str | None = None
    pk: str = ""


class QueryRequest(BaseModel):
    sql: str
    max_rows: int = 5000


class QueryResult(BaseModel):
    columns: list[str]
    rows: list[list[Any]]
    truncated: bool
    row_count: int


class KpiCard(BaseModel):
    label: str
    value: float | int | str
    delta: float | None = None  # % cambio vs periodo anterior, opcional
    suffix: str = ""
    prefix: str = ""
    hint: str | None = None


class TimeSeriesPoint(BaseModel):
    date: str  # YYYY-MM o YYYY-MM-DD
    value: float


class TimeSeries(BaseModel):
    label: str
    points: list[TimeSeriesPoint]


class IntegrationHealth(BaseModel):
    name: str
    unit: str
    last_event_at: str | None
    days_since_last: int | None
    status: str  # ok | warn | error


class ExecutiveOverview(BaseModel):
    cards: list[KpiCard]
    revenue_by_channel: list[TimeSeries]
    integration_health: list[IntegrationHealth]
    top_alerts: list[str]
    generated_at: str


class CategoryValue(BaseModel):
    category: str
    value: float
    extra: dict[str, Any] | None = None


class TopProduct(BaseModel):
    product_id: str | None
    name: str
    sku: str | None = None
    units: int
    revenue: float
    orders: int


class SalesOverview(BaseModel):
    period: str
    channel: str
    cards: list[KpiCard]
    revenue_by_channel: list[TimeSeries]
    payment_status: list[CategoryValue]
    top_products: list[TopProduct]
    top_provinces: list[CategoryValue]
    daily_revenue: list[dict[str, Any]]
    # ERP-alineado
    by_region: list[CategoryValue] | None = None
    top_markup: list[CategoryValue] | None = None
    cost_data_available: bool = False
    by_hour: list[CategoryValue] | None = None
    generated_at: str
