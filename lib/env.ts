// 환경변수 접근. getter 로 감싸 "실제 사용 시점"에만 필수 검증한다.
// (예: Threads 미설정 상태여도 /users 웹훅은 동작하도록 — 모듈 import 만으로 throw 하지 않음)

function required(name: string): string {
  const v = process.env[name];
  if (v == null || v === "") {
    throw new Error(`필수 환경변수가 없어요: ${name}`);
  }
  return v;
}

function optional(name: string): string {
  return process.env[name] ?? "";
}

export const env = {
  get TELEGRAM_BOT_TOKEN() {
    return required("TELEGRAM_BOT_TOKEN");
  },
  get TELEGRAM_CHAT_ID() {
    return required("TELEGRAM_CHAT_ID");
  },
  get TELEGRAM_WEBHOOK_SECRET() {
    return required("TELEGRAM_WEBHOOK_SECRET");
  },
  get SAJUMON_SUPABASE_URL() {
    return required("SAJUMON_SUPABASE_URL");
  },
  get SAJUMON_SERVICE_ROLE_KEY() {
    return required("SAJUMON_SERVICE_ROLE_KEY");
  },
  get PLNL_SUPABASE_URL() {
    return required("PLNL_SUPABASE_URL");
  },
  get PLNL_SERVICE_ROLE_KEY() {
    return required("PLNL_SERVICE_ROLE_KEY");
  },
  // 선택값 — 없으면 Threads 기능만 비활성
  get THREADS_ACCESS_TOKEN() {
    return optional("THREADS_ACCESS_TOKEN");
  },
  get CRON_SECRET() {
    return optional("CRON_SECRET");
  },
};
