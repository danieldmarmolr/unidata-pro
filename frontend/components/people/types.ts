export type PeopleValue = {
  id: number;
  slug: string;
  name: string;
  emoji: string;
  color: string;
  description: string;
  sort_order: number;
  is_active: boolean;
};

export type DirectoryItem = {
  id: number;
  email: string;
  name: string;
  role: string;
  is_admin: boolean;
  is_active: boolean;
  area_id: number | null;
  area_slug: string | null;
  area_name: string | null;
  area_color: string | null;
  manager_user_id: number | null;
  manager_name: string | null;
  manager_email: string | null;
  job_title: string | null;
  bio: string | null;
  birthday_month: number | null;
  birthday_day: number | null;
  birthday_year: number | null;
  joined_at: string | null;
  location_city: string | null;
  avatar_url: string | null;
  interests: string | null;
};

export type OrgChartItem = {
  id: number;
  name: string;
  email: string;
  role: string;
  is_admin: boolean;
  avatar_url: string | null;
  job_title: string | null;
  manager_user_id: number | null;
  manager_name: string | null;
  area_slug: string | null;
  area_name: string | null;
  area_color: string | null;
  is_manager: boolean;
  joined_at: string | null;
};

export type FeedReaction = {
  emoji: string;
  count: number;
  reacted: boolean;
};

export type KudoMeta = {
  id: number;
  value_slug: string;
  value_name: string | null;
  value_emoji: string | null;
  value_color: string | null;
  message: string;
  from_user_id: number;
  from_name: string;
  from_avatar: string | null;
  to_user_id: number;
  to_name: string;
  to_avatar: string | null;
};

export type FeedPost = {
  id: number;
  author_id: number;
  author_name: string;
  author_avatar: string | null;
  author_job: string | null;
  author_area_slug: string | null;
  author_area_name: string | null;
  author_area_color: string | null;
  content: string;
  image_url: string | null;
  is_announcement: boolean;
  pinned: boolean;
  pinned_until: string | null;
  pinned_by: number | null;
  requires_read_ack: boolean;
  kudo_id: number | null;
  kudo?: KudoMeta;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  reactions: FeedReaction[];
  comment_count: number;
  has_read: boolean;
};

export type FeedResponse = {
  items: FeedPost[];
  next_before_id: number | null;
};

export type KudoItem = {
  id: number;
  from_user_id: number;
  from_name: string;
  from_avatar: string | null;
  to_user_id: number;
  to_name: string;
  to_avatar: string | null;
  value_slug: string;
  value_name: string | null;
  value_emoji: string | null;
  value_color: string | null;
  message: string;
  post_id: number | null;
  created_at: string;
};

export type LeaderboardEntry = {
  user_id: number;
  name: string;
  avatar_url: string | null;
  area_slug: string | null;
  area_color: string | null;
  n: number;
};

export type LeaderboardByValue = {
  slug: string;
  name: string;
  emoji: string;
  color: string;
  n: number;
};

export type LeaderboardResponse = {
  since_days: number;
  top_receivers: LeaderboardEntry[];
  top_givers: LeaderboardEntry[];
  by_value: LeaderboardByValue[];
};

export type PublicProfile = {
  id: number;
  email: string;
  name: string;
  role: string;
  is_admin: boolean;
  is_active: boolean;
  manager_user_id: number | null;
  manager_id: number | null;
  manager_name: string | null;
  manager_email: string | null;
  job_title: string | null;
  bio: string | null;
  interests: string | null;
  birthday_month: number | null;
  birthday_day: number | null;
  birthday_year: number | null;
  joined_at: string | null;
  location_city: string | null;
  avatar_url: string | null;
  area_slug: string | null;
  area_name: string | null;
  area_color: string | null;
  created_at: string;
  reports: Array<{
    id: number;
    name: string;
    email: string;
    avatar_url: string | null;
    job_title: string | null;
    area_slug: string | null;
    area_name: string | null;
    area_color: string | null;
  }>;
  kudos_received: number;
  kudos_given: number;
  recent_kudos: KudoItem[];
  posts_count: number;
};

export type FeedComment = {
  id: number;
  post_id: number;
  author_id: number;
  author_name: string;
  author_avatar: string | null;
  author_job: string | null;
  author_area_slug: string | null;
  author_area_color: string | null;
  content: string;
  created_at: string;
};
