// 텔레그램 슬래시 명령 파싱/응답 (§F2). 명령은 영문, 응답은 한글.
import { getAppStats, type AppKey } from "./supabase";
import {
  getRecentPosts,
  ThreadsNotConnectedError,
  ThreadsAuthError,
  type ThreadsPost,
} from "./threads";
import {
  getRecentMedia,
  getFollowerCount as getInstagramFollowers,
  InstagramNotConnectedError,
  InstagramAuthError,
  type InstagramPost,
} from "./instagram";
import { kstShortDate } from "./time";
import { fmt } from "./format";

/** 명령을 처리해 답장 텍스트를 만든다. 명령이 아니거나 무시할 입력이면 null. */
export async function handleCommand(raw: string): Promise<string | null> {
  const text = (raw ?? "").trim();
  if (!text.startsWith("/")) return null;

  const [cmdRaw, ...args] = text.split(/\s+/);
  // '/users@MyBot' → 'users'
  const cmd = cmdRaw!.replace(/^\//, "").split("@")[0]!.toLowerCase();

  switch (cmd) {
    case "users":
      return usersReply(args);
    case "threads":
      return threadsReply(args);
    case "instagram":
    case "insta":
    case "ig":
      return instagramReply(args);
    case "help":
    case "start":
      return helpReply();
    default:
      return "모르는 명령이에요. /help 를 참고하세요.";
  }
}

function parseAppArg(args: string[]): AppKey | null {
  const a = (args[0] ?? "").toLowerCase();
  if (!a) return null;
  if (["saju", "sajumon", "사주몬", "사주"].includes(a)) return "saju";
  if (["plnl", "뺄래낼래", "빨래낼래", "뺄래", "빨래"].includes(a)) return "plnl";
  return null;
}

async function usersReply(args: string[]): Promise<string> {
  const only = parseAppArg(args);
  const keys: AppKey[] = only ? [only] : ["saju", "plnl"];
  const stats = await Promise.all(keys.map((k) => getAppStats(k)));

  const lines: string[] = ["👥 유저 현황", ""];
  for (const s of stats) {
    lines.push(`${s.app.emoji} ${s.app.label}`);
    if (s.error) {
      lines.push(` · 조회 실패: ${s.error}`);
    } else {
      lines.push(` · 누적 ${fmt(s.total)}명`);
      lines.push(` · 오늘 신규 +${fmt(s.todayNew)} · 어제 +${fmt(s.yesterdayNew)}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

async function threadsReply(args: string[]): Promise<string> {
  let posts: ThreadsPost[];
  try {
    // getRecentPosts 가 1~10 클램프·기본 5(NaN 포함)를 처리
    posts = await getRecentPosts(parseInt(args[0] ?? "", 10));
  } catch (e) {
    if (e instanceof ThreadsNotConnectedError || e instanceof ThreadsAuthError) {
      return "🧵 Threads 연결이 만료됐어요 — 토큰 갱신이 필요해요.";
    }
    return `🧵 Threads 조회 실패: ${(e as Error).message}`;
  }

  if (posts.length === 0) return "🧵 최근 게시물이 없어요.";

  const lines: string[] = [`🧵 최근 게시물 ${posts.length}개`, ""];
  for (const p of posts) {
    const date = kstShortDate(p.timestamp);
    const body = (p.text ?? "").replace(/\s+/g, " ").trim().slice(0, 20) || "(본문 없음)";
    lines.push(`${date} · ${body}`);
    lines.push(` 👁 ${fmt(p.views ?? 0)} · 💬 ${fmt(p.replies ?? 0)} · ❤️ ${fmt(p.likes ?? 0)}`);
    lines.push(` ${p.permalink}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

async function instagramReply(args: string[]): Promise<string> {
  let posts: InstagramPost[];
  let followers: number | null;
  try {
    // getRecentMedia 가 1~10 클램프·기본 5(NaN 포함)를 처리
    [posts, followers] = await Promise.all([
      getRecentMedia(parseInt(args[0] ?? "", 10)),
      getInstagramFollowers(),
    ]);
  } catch (e) {
    if (e instanceof InstagramNotConnectedError || e instanceof InstagramAuthError) {
      return "📷 Instagram 연결이 만료됐어요 — 토큰 갱신이 필요해요.";
    }
    return `📷 Instagram 조회 실패: ${(e as Error).message}`;
  }

  const header = followers != null ? `📷 팔로워 ${fmt(followers)}` : "📷 Instagram";
  if (posts.length === 0) return `${header} · 최근 게시물이 없어요.`;

  const lines: string[] = [`${header} · 최근 게시물 ${posts.length}개`, ""];
  for (const p of posts) {
    const date = kstShortDate(p.timestamp);
    const caption = (p.caption ?? "").replace(/\s+/g, " ").trim().slice(0, 20) || "(캡션 없음)";
    lines.push(`${date} · ${caption}`);
    const metrics: string[] = [];
    if (p.views != null) metrics.push(`👁 ${fmt(p.views)}`);
    metrics.push(`❤️ ${fmt(p.likes ?? 0)}`);
    metrics.push(`💬 ${fmt(p.comments ?? 0)}`);
    lines.push(` ${metrics.join(" · ")}`);
    lines.push(` ${p.permalink}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function helpReply(): string {
  return [
    "🤖 운영 알림 봇",
    "",
    "/users — 두 앱 유저 현황 (누적·오늘·어제 신규)",
    "/users saju | plnl — 한 앱만",
    "/threads — 최근 게시물 5개 성과",
    "/threads 10 — 최근 N개 (최대 10)",
    "/instagram — 인스타 팔로워·최근 게시물 조회수",
    "/help — 이 도움말",
    "",
    "매일 아침 9시(KST)에 다이제스트를 보내드려요.",
  ].join("\n");
}
