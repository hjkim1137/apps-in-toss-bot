// KST(Asia/Seoul, UTC+9, DST 없음) 기준 일(day) 경계 계산.
//
// KST 일 경계를 한 곳에서 계산해 자정 부근 신규 유저가 어제/오늘로 잘못 집계되는 것을 막는다.
//  - kstMidnightStr : 유저 집계용. 두 앱 모두 created_at 이 KST wall-clock timestamp 라 이 문자열로 비교.
//  - utcMidnightIso : Threads 게시물 timestamp(UTC ISO)를 KST 일 범위로 거를 때 사용(digest).

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

export interface KstDay {
  /** KST 달력 날짜 'YYYY-MM-DD' */
  dateStr: string;
  /** KST 00:00 을 UTC 순간으로 표현한 ISO — Threads 게시물(UTC ISO) 날짜 범위 비교용 */
  utcMidnightIso: string;
  /** KST 00:00 wall-clock 'YYYY-MM-DD 00:00:00' — 두 앱 유저 created_at(KST) 집계용 */
  kstMidnightStr: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** KST 달력 (연, 0-based 월, 일) 로부터 KstDay 를 만든다. */
function fromCalendar(y: number, m0: number, d: number): KstDay {
  // KST 00:00 을 UTC 순간으로: 해당 wall-clock 에서 9시간을 뺀다.
  const utcMidnight = new Date(Date.UTC(y, m0, d, 0, 0, 0) - KST_OFFSET_MS);
  const dateStr = `${y}-${pad(m0 + 1)}-${pad(d)}`;
  return {
    dateStr,
    utcMidnightIso: utcMidnight.toISOString(),
    kstMidnightStr: `${dateStr} 00:00:00`,
  };
}

/**
 * `now`(UTC 순간) 기준 KST 의 오늘/어제/그제 경계를 돌려준다.
 * 월·연 경계는 Date.UTC 의 필드 정규화로 자동 처리된다(KST 는 DST 가 없어 안전).
 */
export function kstDays(now: Date = new Date()) {
  // UTC 순간을 KST wall-clock 으로 옮긴 뒤 UTC getter 로 달력 필드를 읽는다.
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m0 = kst.getUTCMonth();
  const d = kst.getUTCDate();

  const shift = (offsetDays: number): KstDay => {
    const norm = new Date(Date.UTC(y, m0, d + offsetDays));
    return fromCalendar(norm.getUTCFullYear(), norm.getUTCMonth(), norm.getUTCDate());
  };

  return {
    today: shift(0),
    yesterday: shift(-1),
    dayBefore: shift(-2), // 그제
  };
}

/** 다이제스트 헤더용 라벨: '7/9(수)' */
export function kstDateLabel(day: KstDay): string {
  const [y, m, d] = day.dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return `${m}/${d}(${WEEKDAYS_KO[dow]})`;
}

/** ISO timestamp 를 KST 'M/D' 로 (Threads 게시물 날짜 표시용) */
export function kstShortDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const kst = new Date(t + KST_OFFSET_MS);
  return `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}`;
}
