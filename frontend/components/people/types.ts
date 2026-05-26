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
  hidden_from_directory?: boolean;
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
  hidden_from_directory?: boolean;
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

export type PollOption = {
  id: number;
  label: string;
  sort_order: number;
  votes: number;
  my_vote: boolean;
};

export type Poll = {
  id: number;
  question: string;
  multi_choice: boolean;
  closes_at: string | null;
  options: PollOption[];
  total_voters: number;
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
  space_id: number | null;
  space_slug: string | null;
  space_name: string | null;
  space_emoji: string | null;
  space_color: string | null;
  space_kind: "area" | "global" | "custom" | null;
  content: string;
  image_url: string | null;
  is_announcement: boolean;
  pinned: boolean;
  pinned_until: string | null;
  pinned_by: number | null;
  requires_read_ack: boolean;
  kudo_id: number | null;
  kudo?: KudoMeta;
  edited_at?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  reactions: FeedReaction[];
  comment_count: number;
  has_read: boolean;
  bookmarked?: boolean;
  poll?: Poll;
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

// ============================================================
// Spaces, DMs, Notifications, Mentions
// ============================================================

export type Space = {
  id: number;
  slug: string;
  name: string;
  kind: "area" | "global" | "custom";
  area_id: number | null;
  emoji: string;
  color: string;
  description: string;
  posting_policy: "everyone" | "admins_only" | "area_members";
  sort_order: number;
  is_active: boolean;
  last_post_at: string | null;
  posts_count: number;
  is_default_for_viewer: boolean;
  created_at: string;
};

export type MentionUser = {
  id: number;
  name: string;
  email: string;
  avatar_url: string | null;
  job_title: string | null;
  area_slug: string | null;
  area_color: string | null;
  area_name: string | null;
};

export type ConversationMember = {
  id: number;
  name: string;
  email: string;
  avatar_url: string | null;
  job_title: string | null;
  area_color: string | null;
  area_name: string | null;
};

export type Conversation = {
  id: number;
  kind: "dm" | "group";
  name: string | null;
  created_by: number;
  last_message_at: string;
  created_at: string;
  last_read_at: string;
  last_preview: string | null;
  last_author_id: number | null;
  unread_count: number;
  members: ConversationMember[];
};

export type DMMessage = {
  id: number;
  conversation_id: number;
  author_id: number;
  author_name: string;
  author_avatar: string | null;
  author_area_color: string | null;
  content: string;
  image_url: string | null;
  created_at: string;
};

export type NotificationItem = {
  id: number;
  user_id: number;
  kind: "mention" | "kudo" | "comment" | "dm" | "announcement" | string;
  actor_user_id: number | null;
  actor_name: string | null;
  actor_avatar: string | null;
  actor_area_color: string | null;
  source_kind: string | null;
  source_id: number | null;
  preview: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export type NotificationBadge = {
  notifications_unread: number;
  dms_unread: number;
  total: number;
};
