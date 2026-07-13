// Instagram Graph API 연동 (Instagram 로그인 방식) — 최근 미디어/조회수/팔로워/토큰 갱신.
// 프로페셔널(비즈니스·크리에이터) 계정 + instagram_business_basic·instagram_business_manage_insights 가정.
import { env } from "./env";
import { kvGet, kvSet } from "./kv";
import { extractInsightValue, type InsightItem } from "./insights";

const GRAPH = "https://graph.instagram.com";
const VERSION = "v21.0";

const TOKEN_KEY = "instagram_access_token";
const EXPIRES_KEY = "instagram_token_expires_at";
export const IG_FOLLOWERS_KEY = "instagram_followers_last";

export class InstagramNotConnectedError extends Error {
  constructor(message = "Instagram 토큰이 설정되지 않았어요.") {
    super(message);
    this.name = "InstagramNotConnectedError";
  }
}
export class InstagramAuthError extends Error {
  constructor(message = "Instagram 토큰이 만료됐거나 권한이 부족해요.") {
    super(message);
    this.name = "InstagramAuthError";
  }
}

export interface InstagramPost {
  id: string;
  caption: string;
  mediaType: string; // IMAGE | VIDEO | CAROUSEL_ALBUM
  timestamp: string; // ISO
  permalink: string;
  views?: number; // 사진은 값이 없을 수 있음(그때는 미표기)
  likes?: number;
  comments?: number;
}

interface GraphError {
  error?: { message?: string; code?: number; type?: string };
}

async function currentToken(): Promise<string | null> {
  const stored = await kvGet(TOKEN_KEY).catch(() => null);
  return stored ?? env.INSTAGRAM_ACCESS_TOKEN ?? null;
}

function graphErrorToThrow(json: GraphError, status: number): Error {
  const msg = json?.error?.message ?? `HTTP ${status}`;
  if (status === 401 || json?.error?.code === 190) return new InstagramAuthError(msg);
  return new Error(`Instagram API 오류: ${msg}`);
}

/** 미디어 조회수(views). 사진 등 metric 미지원이면 throw → 호출측에서 무시. */
async function getMediaViews(mediaId: string, token: string): Promise<number | undefined> {
  const url = `${GRAPH}/${VERSION}/${mediaId}/insights?metric=views&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const json = (await res.json()) as GraphError & { data?: Array<InsightItem & { name: string }> };
  if (!res.ok) throw graphErrorToThrow(json, res.status);
  const item = (json.data ?? []).find((d) => d.name === "views") ?? json.data?.[0];
  return item ? extractInsightValue(item) : undefined;
}

/** 최근 미디어 목록 + 각 미디어 조회수. limit 1~10 */
export async function getRecentMedia(limit = 5): Promise<InstagramPost[]> {
  const token = await currentToken();
  if (!token) throw new InstagramNotConnectedError();

  const n = Math.min(Math.max(Math.floor(limit) || 5, 1), 10);
  const fields = "id,caption,media_type,timestamp,permalink,like_count,comments_count";
  const listUrl = `${GRAPH}/${VERSION}/me/media?fields=${fields}&limit=${n}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(listUrl);
  const json = (await res.json()) as GraphError & {
    data?: Array<{
      id: string;
      caption?: string;
      media_type?: string;
      timestamp: string;
      permalink: string;
      like_count?: number;
      comments_count?: number;
    }>;
  };
  if (!res.ok) throw graphErrorToThrow(json, res.status);

  const posts: InstagramPost[] = (json.data ?? []).map((m) => ({
    id: m.id,
    caption: m.caption ?? "",
    mediaType: m.media_type ?? "",
    timestamp: m.timestamp,
    permalink: m.permalink,
    likes: m.like_count,
    comments: m.comments_count,
  }));

  // 조회수는 관대하게(사진 등 미지원이면 undefined 로 남기고 계속)
  await Promise.all(
    posts.map(async (post) => {
      try {
        post.views = await getMediaViews(post.id, token);
      } catch {
        /* 조회수만 실패 — 미디어 자체는 표시 */
      }
    }),
  );
  return posts;
}

/** 팔로워 수. 실패/미설정 시 null */
export async function getFollowerCount(): Promise<number | null> {
  const token = await currentToken();
  if (!token) return null;
  const url = `${GRAPH}/${VERSION}/me?fields=followers_count&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as { followers_count?: number };
  return json.followers_count ?? null;
}

export interface TokenRefreshResult {
  refreshed: boolean;
  reason?: string;
  expiresAt?: string;
}

/** 만료 thresholdDays 이내면 장기 토큰(60일)을 ig_refresh_token 으로 갱신하고 ops_kv 에 저장. */
export async function refreshTokenIfNeeded(thresholdDays = 7): Promise<TokenRefreshResult> {
  const [token, storedExpiry] = await Promise.all([
    currentToken(),
    kvGet(EXPIRES_KEY).catch(() => null),
  ]);
  if (!token) return { refreshed: false, reason: "no-token" };

  const now = Date.now();
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  if (storedExpiry) {
    const expiresAt = Date.parse(storedExpiry);
    if (!Number.isNaN(expiresAt) && expiresAt - now > thresholdMs) {
      return { refreshed: false, reason: "still-valid", expiresAt: storedExpiry };
    }
  }

  const url = `${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const json = (await res.json()) as GraphError & { access_token?: string; expires_in?: number };
  if (!res.ok || !json.access_token) {
    return { refreshed: false, reason: `refresh-failed: ${json?.error?.message ?? `HTTP ${res.status}`}` };
  }

  const expiresIn = Number(json.expires_in ?? 0); // seconds (~60일)
  const newExpiry = expiresIn > 0 ? new Date(now + expiresIn * 1000).toISOString() : undefined;
  await kvSet(TOKEN_KEY, json.access_token);
  if (newExpiry) await kvSet(EXPIRES_KEY, newExpiry);
  return { refreshed: true, expiresAt: newExpiry };
}
