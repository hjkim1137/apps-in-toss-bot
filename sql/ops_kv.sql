-- ops_kv: 운영 봇 전용 key-value 저장소 (뺄래낼래 Supabase 프로젝트에 생성)
-- 용도: 갱신되는 Threads 장기 토큰/만료시각/직전 팔로워 수 등 배포 없이 바뀌는 상태 보관.
-- 보안: RLS 를 켜되 정책을 두지 않아 anon/authenticated 는 전면 차단.
--       service_role 키는 RLS 를 우회하므로 서버(apps-in-toss-bot)에서만 접근 가능.

create table if not exists public.ops_kv (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table public.ops_kv enable row level security;
-- (의도적으로 어떤 policy 도 만들지 않음 → service_role 외 접근 불가)

-- 참고로 저장되는 키:
--   threads_access_token      : 현재 유효한 Threads 장기 토큰
--   threads_token_expires_at  : 토큰 만료 예정 시각 (ISO 8601)
--   threads_followers_last    : 직전 다이제스트 시점의 팔로워 수 (전일 대비 계산용)
