// Meta Threads API 연동 — 게시물 목록/인사이트/토큰 갱신 (§2-2).
// 본인 계정 게시물만 조회하며, threads_basic + threads_manage_insights 권한을 가정한다.
import { env } from "./env";
import { kvGet, kvSet } from "./kv";
import { extractInsightValue, type InsightItem } from "./insights";

const GRAPH = "https://graph.threads.net";
const VERSION = "v1.0";

const TOKEN_KEY = "threads_access_token";
const EXPIRES_KEY = "threads_token_expires_at";
export const FOLLOWERS_KEY = "threads_followers_last";

export class ThreadsNotConnectedError extends Error {
  constructor(message = "Threads 토큰이 설정되지 않았어요.") {
    super(message);
    this.name = "ThreadsNotConnectedError";
  }
}
export class ThreadsAuthError extends Error {
  constructor(message = "Threads 토큰이 만료됐거나 권한이 부족해요.") {
    super(message);
    this.name = "ThreadsAuthError";
  }
}

export interface ThreadsPost {
  id: string;
  text: string;
  timestamp: string; // ISO
  permalink: string;
  views?: number;
  likes?: number;
  replies?: number;
}

/** 저장된 토큰(우선) 또는 최초 env 토큰. 둘 다 없으면 null */
async function currentToken(): Promise<string | null> {
  const stored = await kvGet(TOKEN_KEY).catch(() => null);
  return stored ?? env.THREADS_ACCESS_TOKEN ?? null;
}

interface GraphError {
  error?: { message?: string; code?: number; type?: string };
}

function graphErrorToThrow(json: GraphError, status: number): Error {
  const msg = json?.error?.message ?? `HTTP ${status}`;
  // 401 또는 code 190 = 토큰 만료/무효 → ThreadsAuthError, 그 외는 일반 오류
  if (status === 401 || json?.error?.code === 190) return new ThreadsAuthError(msg);
  return new Error(`Threads API 오류: ${msg}`);
}

async function getMediaInsights(
  mediaId: string,
  token: string,
): Promise<{ views: number; likes: number; replies: number }> {
  const url = `${GRAPH}/${VERSION}/${mediaId}/insights?metric=views,likes,replies&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const json = (await res.json()) as GraphError & { data?: Array<InsightItem & { name: string }> };
  if (!res.ok) throw graphErrorToThrow(json, res.status);
  const map: Record<string, number> = {};
  for (const item of json.data ?? []) map[item.name] = extractInsightValue(item);
  return {
    views: map.views ?? 0,
    likes: map.likes ?? 0,
    replies: map.replies ?? 0,
  };
}

/** 최근 게시물 목록 + 각 게시물 인사이트(조회수/좋아요/댓글). limit 1~10 */
export async function getRecentPosts(limit = 5): Promise<ThreadsPost[]> {
  const token = await currentToken();
  if (!token) throw new ThreadsNotConnectedError();

  const n = Math.min(Math.max(Math.floor(limit) || 5, 1), 10);
  const listUrl = `${GRAPH}/${VERSION}/me/threads?fields=id,text,timestamp,permalink&limit=${n}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(listUrl);
  const json = (await res.json()) as GraphError & {
    data?: Array<{ id: string; text?: string; timestamp: string; permalink: string }>;
  };
  if (!res.ok) throw graphErrorToThrow(json, res.status);

  const posts: ThreadsPost[] = (json.data ?? []).map((p) => ({
    id: p.id,
    text: p.text ?? "",
    timestamp: p.timestamp,
    permalink: p.permalink,
  }));

  // 게시물별 인사이트는 관대하게(실패해도 undefined 로 남기고 계속)
  await Promise.all(
    posts.map(async (post) => {
      try {
        const ins = await getMediaInsights(post.id, token);
        post.views = ins.views;
        post.likes = ins.likes;
        post.replies = ins.replies;
      } catch {
        /* 인사이트만 실패 — 게시물 자체는 표시 */
      }
    }),
  );
  return posts;
}

/** 계정 팔로워 수(옵션). 실패/미설정 시 null */
export async function getFollowerCount(): Promise<number | null> {
  const token = await currentToken();
  if (!token) return null;
  const url = `${GRAPH}/${VERSION}/me/threads_insights?metric=followers_count&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: InsightItem[] };
  const item = json.data?.[0];
  return item ? extractInsightValue(item) : null;
}

interface TokenRefreshResult {
  refreshed: boolean;
  reason?: string;
  expiresAt?: string;
}

/**
 * 만료 `thresholdDays` 이내면 장기 토큰을 갱신하고 ops_kv 에 저장(§2-2).
 * 최초 실행(저장된 만료시각 없음) 시에도 갱신을 시도해 kv 를 부트스트랩한다.
 * (갱신은 토큰이 발급 후 24시간 이상 경과해야 성공 — 갓 발급한 토큰이면 다음 날 성공)
 */
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

  const url = `${GRAPH}/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(token)}`;
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
