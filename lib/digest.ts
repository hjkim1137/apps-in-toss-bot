// 매일 아침 다이제스트 텍스트 생성 (§F1).
import { getAppStats, type AppStats } from "./supabase";
import {
  getFollowerCount as getThreadsFollowers,
  getRecentPosts,
  FOLLOWERS_KEY,
  ThreadsNotConnectedError,
} from "./threads";
import {
  getFollowerCount as getInstagramFollowers,
  getRecentMedia,
  IG_FOLLOWERS_KEY,
  InstagramNotConnectedError,
} from "./instagram";
import { kvGet, kvSet } from "./kv";
import { kstDays, kstDateLabel } from "./time";
import { fmt } from "./format";

/** 전일 대비 증감 표기: ▲n / ▼n / ±0 */
function deltaMark(cur: number, prev: number): string {
  const d = cur - prev;
  if (d > 0) return `▲${fmt(d)}`;
  if (d < 0) return `▼${fmt(Math.abs(d))}`;
  return "±0";
}

/** 큰 수 축약: 12000 → '1.2만' */
function compact(n: number): string {
  if (n >= 10000) {
    const man = (n / 10000).toFixed(1).replace(/\.0$/, "");
    return `${man}만`;
  }
  return fmt(n);
}

function appBlock(s: AppStats): string[] {
  const lines = [`${s.app.emoji} ${s.app.label}`];
  if (s.error) {
    lines.push(` · 조회 실패: ${s.error}`);
    return lines;
  }
  lines.push(` · 누적 ${fmt(s.total)}명 (+${fmt(s.yesterdayNew)} 어제)`);
  lines.push(` · 전일 대비 ${deltaMark(s.yesterdayNew, s.dayBeforeNew)} (그제 +${fmt(s.dayBeforeNew)})`);
  return lines;
}

interface SocialPost {
  timestamp: string; // ISO
  views?: number;
}

interface SocialConfig {
  label: string; // "🧵 Threads" | "📷 Instagram"
  getPosts: (limit: number) => Promise<SocialPost[]>;
  getFollowers: () => Promise<number | null>;
  followersKey: string;
  NotConnected: new (message?: string) => Error;
}

/** SNS 섹션(옵션): 팔로워(전일 대비) + 어제 게시물 수·최고 조회수. 토큰 미설정이면 섹션 생략. */
async function socialBlock(now: Date, cfg: SocialConfig): Promise<string[] | null> {
  try {
    const [posts, followers, prevRaw] = await Promise.all([
      cfg.getPosts(10),
      cfg.getFollowers(),
      kvGet(cfg.followersKey).catch(() => null),
    ]);

    const { yesterday, today } = kstDays(now);
    const yStart = Date.parse(yesterday.utcMidnightIso);
    const yEnd = Date.parse(today.utcMidnightIso);
    const yPosts = posts.filter((p) => {
      const t = Date.parse(p.timestamp);
      return t >= yStart && t < yEnd;
    });
    const views = yPosts.map((p) => p.views).filter((v): v is number => v != null);
    const maxViews = views.length ? Math.max(...views) : null;

    const lines = [cfg.label];
    if (followers != null) {
      const prev = prevRaw != null ? Number(prevRaw) : NaN;
      const deltaStr = Number.isFinite(prev) ? ` (${deltaMark(followers, prev)})` : "";
      lines.push(` · 팔로워 ${fmt(followers)}${deltaStr}`);
      await kvSet(cfg.followersKey, String(followers)).catch(() => {});
    }
    lines.push(
      ` · 어제 게시물 ${yPosts.length}건${maxViews != null ? ` · 최고 조회 ${compact(maxViews)}` : ""}`,
    );
    return lines;
  } catch (e) {
    if (e instanceof cfg.NotConnected) return null; // 미설정 → 섹션 생략
    return [`${cfg.label} · 조회 실패 (토큰 확인 필요)`]; // 만료/오류 → 침묵하지 않고 안내
  }
}

export async function buildDigest(now: Date = new Date()): Promise<string> {
  const { today } = kstDays(now);
  // 앱 집계·Threads·Instagram 은 서로 독립 → 병렬. 출력 순서는 sections 배열이 고정.
  const [[saju, plnl], threads, instagram] = await Promise.all([
    Promise.all([getAppStats("saju", now), getAppStats("plnl", now)]),
    socialBlock(now, {
      label: "🧵 Threads",
      getPosts: getRecentPosts,
      getFollowers: getThreadsFollowers,
      followersKey: FOLLOWERS_KEY,
      NotConnected: ThreadsNotConnectedError,
    }),
    socialBlock(now, {
      label: "📷 Instagram",
      getPosts: getRecentMedia,
      getFollowers: getInstagramFollowers,
      followersKey: IG_FOLLOWERS_KEY,
      NotConnected: InstagramNotConnectedError,
    }),
  ]);

  const sections: string[][] = [
    [`📊 ${kstDateLabel(today)} 아침 리포트`],
    appBlock(saju),
    appBlock(plnl),
  ];
  if (threads) sections.push(threads);
  if (instagram) sections.push(instagram);

  return sections.map((s) => s.join("\n")).join("\n\n");
}
