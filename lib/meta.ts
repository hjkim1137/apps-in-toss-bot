// Threads·Instagram(Meta Graph) 공용 토큰 플럼빙. 두 모듈이 동일하게 쓰던 부분을 모았다.
// 데이터 조회는 API 별로 달라 각 모듈에 남기고, 여기엔 인증/갱신 등 기계적으로 동일한 부분만 둔다.
import { kvGet, kvSet } from "./kv";

export interface GraphError {
  error?: { message?: string; code?: number; type?: string };
}

export interface TokenRefreshResult {
  refreshed: boolean;
  reason?: string;
  expiresAt?: string;
}

/** 요청 개수를 1~max 로 clamp. 숫자가 아니면 기본 5. */
export function clampLimit(limit: number, max = 10): number {
  return Math.min(Math.max(Math.floor(limit) || 5, 1), max);
}

/** 저장된 토큰(ops_kv) 우선, 없으면 최초 env 토큰. 둘 다 없으면 null */
export async function currentToken(tokenKey: string, envToken: string): Promise<string | null> {
  const stored = await kvGet(tokenKey).catch(() => null);
  return stored ?? envToken ?? null;
}

export interface RefreshConfig {
  baseUrl: string; // https://graph.threads.net | https://graph.instagram.com
  grantType: string; // th_refresh_token | ig_refresh_token
  tokenKey: string;
  expiresKey: string;
  envToken: string;
}

/**
 * 만료 thresholdDays 이내면 장기 토큰을 refresh_access_token 으로 갱신하고 ops_kv 에 저장.
 * 최초 실행(저장된 만료시각 없음) 시에도 갱신을 시도해 kv 를 부트스트랩한다.
 * (갱신은 토큰이 발급 후 24시간 이상 경과해야 성공 — 갓 발급한 토큰이면 다음 날 성공)
 */
export async function refreshMetaToken(
  cfg: RefreshConfig,
  thresholdDays = 7,
): Promise<TokenRefreshResult> {
  const [token, storedExpiry] = await Promise.all([
    currentToken(cfg.tokenKey, cfg.envToken),
    kvGet(cfg.expiresKey).catch(() => null),
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

  const url = `${cfg.baseUrl}/refresh_access_token?grant_type=${cfg.grantType}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const json = (await res.json()) as GraphError & { access_token?: string; expires_in?: number };
  if (!res.ok || !json.access_token) {
    return { refreshed: false, reason: `refresh-failed: ${json?.error?.message ?? `HTTP ${res.status}`}` };
  }

  const expiresIn = Number(json.expires_in ?? 0); // seconds (~60일)
  const newExpiry = expiresIn > 0 ? new Date(now + expiresIn * 1000).toISOString() : undefined;
  await kvSet(cfg.tokenKey, json.access_token);
  if (newExpiry) await kvSet(cfg.expiresKey, newExpiry);
  return { refreshed: true, expiresAt: newExpiry };
}
