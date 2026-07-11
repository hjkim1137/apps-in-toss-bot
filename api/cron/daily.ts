// 매일 아침 다이제스트 발송 + Threads 토큰 자동 갱신 (§F1, §2-2).
// Vercel Cron(00:00 UTC = 09:00 KST)이 호출. CRON_SECRET 설정 시 Bearer 로 보호된다.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { env } from "../../lib/env";
import { buildDigest } from "../../lib/digest";
import { broadcast } from "../../lib/telegram";
import { refreshTokenIfNeeded } from "../../lib/threads";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel cron 은 CRON_SECRET env 가 있으면 Authorization: Bearer <CRON_SECRET> 를 자동 첨부한다.
  // (수동 검증 시에도 같은 헤더를 붙여 호출하면 됨)
  if (env.CRON_SECRET) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${env.CRON_SECRET}`) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }

  try {
    // 다이제스트가 최신 토큰을 쓰도록 갱신을 먼저 시도(실패해도 다이제스트는 계속)
    const token = await refreshTokenIfNeeded().catch((e) => ({
      refreshed: false,
      reason: (e as Error).message,
    }));

    const text = await buildDigest();
    await broadcast(env.TELEGRAM_CHAT_IDS, text);

    return res.status(200).json({ ok: true, token });
  } catch (e) {
    const message = (e as Error).message;
    // 실패도 조용히 넘기지 않고 알림
    await broadcast(env.TELEGRAM_CHAT_IDS, `⚠️ 아침 리포트 생성 실패: ${message}`).catch(() => {});
    return res.status(500).json({ ok: false, error: message });
  }
}
