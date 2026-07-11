// 매일 아침 다이제스트 텍스트 생성 (§F1).
import { getAppStats, type AppStats } from "./supabase";
import { getFollowerCount, getRecentPosts, FOLLOWERS_KEY, ThreadsNotConnectedError } from "./threads";
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

/** Threads 섹션(옵션). 토큰 미설정이면 섹션 자체를 생략한다. */
async function threadsBlock(now: Date): Promise<string[] | null> {
  try {
    const [posts, followers, prevRaw] = await Promise.all([
      getRecentPosts(10),
      getFollowerCount(),
      kvGet(FOLLOWERS_KEY).catch(() => null),
    ]);

    const { yesterday, today } = kstDays(now);
    const yStart = Date.parse(yesterday.utcMidnightIso);
    const yEnd = Date.parse(today.utcMidnightIso);
    const yPosts = posts.filter((p) => {
      const t = Date.parse(p.timestamp);
      return t >= yStart && t < yEnd;
    });
    const maxViews = yPosts.reduce((m, p) => Math.max(m, p.views ?? 0), 0);

    const lines = ["🧵 Threads"];
    if (followers != null) {
      const prev = prevRaw != null ? Number(prevRaw) : NaN;
      const deltaStr = Number.isFinite(prev) ? ` (${deltaMark(followers, prev)})` : "";
      lines.push(` · 팔로워 ${fmt(followers)}${deltaStr}`);
      await kvSet(FOLLOWERS_KEY, String(followers)).catch(() => {});
    }
    lines.push(
      ` · 어제 게시물 ${yPosts.length}건${yPosts.length ? ` · 최고 조회 ${compact(maxViews)}` : ""}`,
    );
    return lines;
  } catch (e) {
    if (e instanceof ThreadsNotConnectedError) return null; // 미설정 → 섹션 생략
    return ["🧵 Threads · 조회 실패 (토큰 확인 필요)"]; // 만료/오류 → 침묵하지 않고 안내
  }
}

export async function buildDigest(now: Date = new Date()): Promise<string> {
  const { today } = kstDays(now);
  // 앱 집계와 Threads 조회는 서로 독립 → 병렬. 출력 순서는 sections 배열이 고정.
  const [[saju, plnl], threads] = await Promise.all([
    Promise.all([getAppStats("saju", now), getAppStats("plnl", now)]),
    threadsBlock(now),
  ]);

  const sections: string[][] = [
    [`📊 ${kstDateLabel(today)} 아침 리포트`],
    appBlock(saju),
    appBlock(plnl),
  ];
  if (threads) sections.push(threads);

  return sections.map((s) => s.join("\n")).join("\n\n");
}
