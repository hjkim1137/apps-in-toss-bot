// Meta Threads API 연동 — 게시물 목록/인사이트/토큰 갱신 (§2-2).
// 본인 계정 게시물만 조회하며, threads_basic + threads_manage_insights 권한을 가정한다.
import { env } from "./env";
import { extractInsightValue, type InsightItem } from "./insights";
import {
  clampLimit,
  currentToken,
  refreshMetaToken,
  type GraphError,
  type TokenRefreshResult,
} from "./meta";

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
  const token = await currentToken(TOKEN_KEY, env.THREADS_ACCESS_TOKEN);
  if (!token) throw new ThreadsNotConnectedError();

  const n = clampLimit(limit);
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
  const token = await currentToken(TOKEN_KEY, env.THREADS_ACCESS_TOKEN);
  if (!token) return null;
  const url = `${GRAPH}/${VERSION}/me/threads_insights?metric=followers_count&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: InsightItem[] };
  const item = json.data?.[0];
  return item ? extractInsightValue(item) : null;
}

/** 만료 임박 시 장기 토큰 갱신(§2-2). 공용 refreshMetaToken 위임. */
export function refreshTokenIfNeeded(thresholdDays = 7): Promise<TokenRefreshResult> {
  return refreshMetaToken(
    {
      baseUrl: GRAPH,
      grantType: "th_refresh_token",
      tokenKey: TOKEN_KEY,
      expiresKey: EXPIRES_KEY,
      envToken: env.THREADS_ACCESS_TOKEN,
    },
    thresholdDays,
  );
}
