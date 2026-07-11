import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";
import { kstDays, type KstDay } from "./time";

export type AppKey = "saju" | "plnl";

interface AppConfig {
  key: AppKey;
  label: string;
  emoji: string;
  table: string;
}

// 두 앱 모두 created_at 을 KST(Asia/Seoul) wall-clock timestamp 로 저장한다(§2-1 통일).
// 사주몬도 뺄래낼래와 동일 — 각 repo 의 supabase/schema.sql KST 마이그레이션을 먼저 실행해야 집계가 정확.
export const APPS: Record<AppKey, AppConfig> = {
  saju: {
    key: "saju",
    label: "사주몬",
    emoji: "🔮",
    table: "sajumon_aits_users",
  },
  plnl: {
    key: "plnl",
    label: "뺄래낼래",
    emoji: "🏃",
    table: "plnl_aits_users",
  },
};

// 클라이언트는 콜드스타트마다 1회만 생성하도록 캐시.
let sajuClient: SupabaseClient | null = null;
let plnlClient: SupabaseClient | null = null;

function makeClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function sajuSupabase(): SupabaseClient {
  return (sajuClient ??= makeClient(env.SAJUMON_SUPABASE_URL, env.SAJUMON_SERVICE_ROLE_KEY));
}

export function plnlSupabase(): SupabaseClient {
  return (plnlClient ??= makeClient(env.PLNL_SUPABASE_URL, env.PLNL_SERVICE_ROLE_KEY));
}

/** [fromDay, toDay) 구간 신규 유저 수. from/to 가 null 이면 해당 경계 무제한(누적/이후) */
async function countBetween(
  app: AppConfig,
  fromDay: KstDay | null,
  toDay: KstDay | null,
): Promise<number> {
  const db = app.key === "saju" ? sajuSupabase() : plnlSupabase();
  let q = db.from(app.table).select("*", { count: "exact", head: true });
  // 두 앱 모두 KST wall-clock timestamp → KST 자정 문자열('YYYY-MM-DD 00:00:00')로 비교
  if (fromDay) q = q.gte("created_at", fromDay.kstMidnightStr);
  if (toDay) q = q.lt("created_at", toDay.kstMidnightStr);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

export interface AppStats {
  app: AppConfig;
  total: number;
  todayNew: number;
  yesterdayNew: number;
  dayBeforeNew: number; // 그제 신규
  error?: string;
}

/** 한 앱의 누적/오늘/어제/그제 신규 유저 수를 한 번에 조회 */
export async function getAppStats(appKey: AppKey, now: Date = new Date()): Promise<AppStats> {
  const app = APPS[appKey];
  const { today, yesterday, dayBefore } = kstDays(now);
  try {
    const [total, todayNew, yesterdayNew, dayBeforeNew] = await Promise.all([
      countBetween(app, null, null), // 누적
      countBetween(app, today, null), // created_at >= 오늘 00:00 KST
      countBetween(app, yesterday, today), // [어제, 오늘)
      countBetween(app, dayBefore, yesterday), // [그제, 어제)
    ]);
    return { app, total, todayNew, yesterdayNew, dayBeforeNew };
  } catch (e) {
    return {
      app,
      total: 0,
      todayNew: 0,
      yesterdayNew: 0,
      dayBeforeNew: 0,
      error: (e as Error).message,
    };
  }
}
