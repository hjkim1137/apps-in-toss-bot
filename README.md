# apps-in-toss-bot — 운영 알림 봇

사주몬 · 뺄래낼래 공통 운영 알림 봇. 매번 Supabase 대시보드에 들어가지 않고 **텔레그램**에서
① 매일 아침 유저 증감 다이제스트를 받고 ② 슬래시 명령으로 유저 수·Threads 게시물 성과를 즉시 조회한다.

> 기획서: `앱인토스 미니앱/20260709_운영알림봇_기획.md`
> 호스팅: Vercel 서버리스 + Vercel Cron (Hobby 무료 플랜)

## 기능

| # | 기능 | 설명 |
|---|------|------|
| F1 | 매일 아침 다이제스트 | 09:00 KST 텔레그램 푸시 — 앱별 누적/어제 신규/전일 대비 |
| F2 | 슬래시 조회 | `/users`, `/threads`, `/help` |
| F3 | Threads 연동 | 본인 계정 최근 게시물 views·replies·likes + 팔로워 수 |

## 구조

```
api/telegram.ts      # webhook — secret 검증 → chat_id 화이트리스트 → 명령 처리
api/cron/daily.ts    # 다이제스트 생성·발송 + Threads 토큰 자동 갱신
lib/env.ts           # 환경변수 (지연 검증)
lib/time.ts          # KST 일 경계 계산 (앱별 타임존 분기의 핵심)
lib/supabase.ts      # 사주몬/뺄래낼래 클라이언트 2개 + 유저 집계
lib/kv.ts            # ops_kv (뺄래낼래 Supabase) 접근
lib/threads.ts       # Threads 목록·인사이트·토큰 갱신
lib/telegram.ts      # sendMessage / setWebhook / setMyCommands
lib/commands.ts      # 슬래시 명령 파싱·응답
lib/digest.ts        # 아침 다이제스트 텍스트 조립
sql/ops_kv.sql       # ops_kv 테이블 DDL (뺄래낼래 Supabase 에 실행)
```

### 타임존 (중요)

두 앱 모두 `created_at` 을 **KST(Asia/Seoul) wall-clock `timestamp`** 로 저장한다. `lib/time.ts` 가 KST 자정 경계(`'YYYY-MM-DD 00:00:00'`)를 만들어 집계에 쓴다.

| 앱 | 테이블 | created_at |
|----|--------|-----------|
| 사주몬 | `sajumon_aits_users` | `timestamp` (KST wall-clock) |
| 뺄래낼래 | `plnl_aits_users` | `timestamp` (KST wall-clock) |

> ⚠️ 사주몬은 원래 `timestamptz(UTC)` 였다. **사주몬 repo `supabase/schema.sql` 의 KST 마이그레이션을 Supabase 에서 먼저 실행**해야 집계가 정확하다. 미실행 시 사주몬 카운트가 KST↔UTC 로 9시간 어긋난다.

## 사전 준비 (사용자가 직접)

1. 텔레그램 `@BotFather` → `/newbot` → **봇 토큰** 확보
2. 봇에게 아무 말 걸고 `@userinfobot` 등으로 **본인 chat_id** 확인
3. Meta for Developers → 앱 → **Threads 유스케이스** → `threads_basic`,`threads_manage_insights` 승인 → **장기 토큰** (선택, F3용)
4. Supabase 두 프로젝트 → Settings → API → **service role 키 2개**
5. **사주몬 Supabase SQL Editor 에서 `sajumon-apps-in-toss/supabase/schema.sql` 실행** — `created_at` 을 KST wall-clock 으로 마이그레이션 (F1 집계 정확성에 필수)
6. 뺄래낼래 Supabase SQL Editor 에서 `sql/ops_kv.sql` 실행 (F3용)
7. Vercel 새 프로젝트로 이 레포 연결 후 아래 env 등록

## 환경변수 (`.env.example` 참고)

```
TELEGRAM_BOT_TOKEN            TELEGRAM_CHAT_ID            TELEGRAM_WEBHOOK_SECRET
SAJUMON_SUPABASE_URL         SAJUMON_SERVICE_ROLE_KEY
PLNL_SUPABASE_URL            PLNL_SERVICE_ROLE_KEY
THREADS_ACCESS_TOKEN(선택)    CRON_SECRET
```

- `TELEGRAM_CHAT_ID` 은 쉼표로 여러 명 지정 가능(화이트리스트 + 다이제스트 수신자). 예: `111,222`. 각자 봇에게 Start 필요.
- `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET` 은 임의의 긴 랜덤 문자열로 직접 생성.
- service role 키·토큰은 **Vercel env 에만**. 레포/클라이언트에 절대 커밋 금지.

## 개발 / 검증

```bash
npm install
npm run typecheck              # 타입 체크

cp .env.example .env           # 값 채우기
npm run preview:digest         # 다이제스트를 로컬에서 미리보기(발송 X)
npm run send:digest            # 실제로 텔레그램에 발송
```

## 배포 & webhook 등록

```bash
# 1) Vercel 에 배포 (대시보드 연결 또는 `vercel --prod`)
# 2) webhook + 명령어 메뉴 등록 (배포 도메인 사용)
npm run setup:webhook -- https://<배포도메인>/api/telegram
```

- 크론은 `vercel.json` 의 `0 0 * * *` (00:00 UTC = 09:00 KST). Hobby 플랜은 실행 시각 ±최대 59분 오차 허용.
- 크론 수동 트리거(검증):
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://<배포도메인>/api/cron/daily
  ```

## 명령어

| 명령 | 응답 |
|------|------|
| `/users` | 두 앱 누적/오늘 신규/어제 신규 |
| `/users saju` · `/users plnl` | 해당 앱만 (사주몬/뺄래낼래 텍스트도 허용) |
| `/threads` | 최근 게시물 5개 — 날짜·본문 앞 20자·👁 views·💬 replies·❤️ likes·링크 |
| `/threads 10` | 최근 N개 (최대 10) |
| `/help` | 명령 목록 |
| 미등록 chat_id | 무응답 |

## 보안 체크리스트

- webhook: `X-Telegram-Bot-Api-Secret-Token` = `TELEGRAM_WEBHOOK_SECRET` (불일치 401)
- `message.chat.id` 가 `TELEGRAM_CHAT_ID` 목록(쉼표 구분)에 없으면 무응답 종료
- cron: `Authorization: Bearer ${CRON_SECRET}` 검증
- service role 키·토큰은 Vercel env 에만
- 봇 응답에 개인정보 미포함 — 집계 숫자만
