// 텔레그램 Bot API 헬퍼. 메시지는 평문(parse_mode 미사용)으로 보내 이스케이프 이슈를 피한다.
import { env } from "./env";

const api = () => `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

export async function sendMessage(chatId: string | number, text: string): Promise<void> {
  const res = await fetch(`${api()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true, // 링크 프리뷰로 메시지가 길어지지 않게
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram sendMessage 실패: ${res.status} ${body}`);
  }
}

export interface BotCommand {
  command: string; // 영문 소문자만 (텔레그램 제약)
  description: string;
}

export async function setMyCommands(commands: BotCommand[]): Promise<unknown> {
  const res = await fetch(`${api()}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands }),
  });
  return res.json();
}

/** webhook 등록. secret_token 은 이후 수신 요청 헤더 검증에 쓰인다. */
export async function setWebhook(url: string, secret: string): Promise<unknown> {
  const res = await fetch(`${api()}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secret,
      allowed_updates: ["message"],
    }),
  });
  return res.json();
}
