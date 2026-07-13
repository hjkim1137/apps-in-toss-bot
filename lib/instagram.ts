// Instagram Graph API 연동 (Instagram 로그인 방식) — 최근 미디어/조회수/팔로워/토큰 갱신.
// 프로페셔널(비즈니스·크리에이터) 계정 + instagram_business_basic·instagram_business_manage_insights 가정.
import { env } from "./env";
import { extractInsightValue, type InsightItem } from "./insights";
import {
  clampLimit,
  currentToken,
  refreshMetaToken,
  type GraphError,
  type TokenRefreshResult,
} from "./meta";

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
  timestamp: string; // ISO
  permalink: string;
  views?: number; // 사진은 값이 없을 수 있음(그때는 미표기)
  likes?: number;
  comments?: number;
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
  const json = (await res.json()) as GraphError & { data?: InsightItem[] };
  if (!res.ok) throw graphErrorToThrow(json, res.status);
  const item = json.data?.[0];
  return item ? extractInsightValue(item) : undefined;
}

/** 최근 미디어 목록 + 각 미디어 조회수. limit 1~10 */
export async function getRecentMedia(limit = 5): Promise<InstagramPost[]> {
  const token = await currentToken(TOKEN_KEY, env.INSTAGRAM_ACCESS_TOKEN);
  if (!token) throw new InstagramNotConnectedError();

  const n = clampLimit(limit);
  const fields = "id,caption,timestamp,permalink,like_count,comments_count";
  const listUrl = `${GRAPH}/${VERSION}/me/media?fields=${fields}&limit=${n}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(listUrl);
  const json = (await res.json()) as GraphError & {
    data?: Array<{
      id: string;
      caption?: string;
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
  const token = await currentToken(TOKEN_KEY, env.INSTAGRAM_ACCESS_TOKEN);
  if (!token) return null;
  const url = `${GRAPH}/${VERSION}/me?fields=followers_count&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as { followers_count?: number };
  return json.followers_count ?? null;
}

/** 만료 임박 시 장기 토큰(60일) 갱신. 공용 refreshMetaToken 위임. */
export function refreshTokenIfNeeded(thresholdDays = 7): Promise<TokenRefreshResult> {
  return refreshMetaToken(
    {
      baseUrl: GRAPH,
      grantType: "ig_refresh_token",
      tokenKey: TOKEN_KEY,
      expiresKey: EXPIRES_KEY,
      envToken: env.INSTAGRAM_ACCESS_TOKEN,
    },
    thresholdDays,
  );
}
