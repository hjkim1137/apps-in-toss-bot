// 텔레그램 webhook 수신 → secret 검증 → chat_id 화이트리스트 → 명령 처리/응답 (§F2, §5).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { env } from "../lib/env";
import { sendMessage } from "../lib/telegram";
import { handleCommand } from "../lib/commands";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 텔레그램은 POST 로만 전송. 그 외는 조용히 200.
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true });
  }

  // 1) secret 헤더 검증 (불일치 401)
  const secret = req.headers["x-telegram-bot-api-secret-token"];
  if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const update = req.body ?? {};
  const message = update.message ?? update.edited_message;
  const chatId = message?.chat?.id;
  const text: string = message?.text ?? "";

  // 2) 화이트리스트 — 등록된 chat_id 가 아니면 무응답 종료(정보 노출 없음)
  if (chatId == null || String(chatId) !== String(env.TELEGRAM_CHAT_ID)) {
    return res.status(200).json({ ok: true });
  }

  // 3) 명령 처리
  try {
    const reply = await handleCommand(text);
    if (reply) await sendMessage(chatId, reply);
  } catch (e) {
    await sendMessage(chatId, `⚠️ 처리 중 오류가 났어요: ${(e as Error).message}`).catch(() => {});
  }

  // 텔레그램에는 항상 200 으로 응답(재전송 폭주 방지)
  return res.status(200).json({ ok: true });
}
