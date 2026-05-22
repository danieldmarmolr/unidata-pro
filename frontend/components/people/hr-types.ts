export type TimeOff = {
  id: number;
  user_id: number;
  user_name: string;
  user_avatar: string | null;
  area_color: string | null;
  area_name: string | null;
  kind: "vacaciones" | "licencia" | "home_office" | "viaje_work" | "otro";
  starts_on: string;
  ends_on: string;
  days_count: number;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reviewer_id: number | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  review_note: string;
  created_at: string;
};

export type OnboardingTask = {
  id: number;
  user_id: number;
  title: string;
  description: string;
  assignee_id: number | null;
  assignee_name: string | null;
  assignee_avatar: string | null;
  due_date: string | null;
  sort_order: number;
  status: "pending" | "in_progress" | "done" | "skipped";
  completed_at: string | null;
  completed_by: number | null;
  created_by: number | null;
  created_at: string;
};

export type OneOnOne = {
  id: number;
  manager_id: number;
  manager_name: string;
  manager_avatar: string | null;
  report_id: number;
  report_name: string;
  report_avatar: string | null;
  scheduled_at: string;
  completed_at: string | null;
  notes: string;
  action_items: Array<{ text: string; done: boolean }>;
  created_at: string;
  updated_at: string;
};

export type PulseSurvey = {
  id: number;
  kind: "pulse" | "enps" | "custom";
  question: string;
  scale: "nps" | "1-5" | "1-10" | "yes_no" | "options";
  options: string[];
  anonymous: boolean;
  starts_at: string;
  ends_at: string | null;
  created_by: number | null;
  created_at: string;
  is_active: boolean;
  has_responded?: boolean;
  response_count?: number;
};

export type SurveyResults = {
  survey: PulseSurvey;
  response_count: number;
  average: number | null;
  distribution: Record<string, number>;
  enps: number | null;
  comments: string[];
};
