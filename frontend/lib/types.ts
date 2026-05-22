export type LoginResponse = {
  access_token: string;
  token_type: string;
  user: string;
};

export type KpiCard = {
  label: string;
  value: number | string;
  delta?: number | null;
  delta_yoy?: number | null;
  delta_yoy_label?: string | null;
  target?: number | null;
  target_direction?: "lower_is_better" | "higher_is_better" | null;
  delta_target?: number | null;
  prefix?: string;
  suffix?: string;
  hint?: string | null;
};

export type Story = { tone: "ok" | "warn" | "alert"; text: string };

export type TimeSeriesPoint = { date: string; value: number };
export type TimeSeries = { label: string; points: TimeSeriesPoint[] };

export type IntegrationHealth = {
  name: string;
  unit: string;
  last_event_at: string | null;
  days_since_last: number | null;
  status: "ok" | "warn" | "error";
};

export type ExecutiveOverview = {
  cards: KpiCard[];
  revenue_by_channel: TimeSeries[];
  integration_health: IntegrationHealth[];
  top_alerts: string[];
  generated_at: string;
};

export type CategoryValue = {
  category: string;
  value: number;
  extra?: Record<string, number | string | boolean | null> | null;
};

export type TopProduct = {
  product_id: string | null;
  name: string;
  sku: string | null;
  units: number;
  revenue: number;
  orders: number;
};

export type SalesOverview = {
  period: string;
  channel: string;
  cards: KpiCard[];
  revenue_by_channel: TimeSeries[];
  payment_status: CategoryValue[];
  top_products: TopProduct[];
  top_provinces: CategoryValue[];
  daily_revenue: TimeSeriesPoint[];
  by_region?: CategoryValue[];
  top_markup?: CategoryValue[];
  cost_data_available?: boolean;
  by_hour?: CategoryValue[];
  generated_at: string;
};
