// 텔레그램 webhook 등록 + 명령어 메뉴 등록. (§7 2단계)
// 사용: npm run setup:webhook -- https://<배포도메인>/api/telegram
import "dotenv/config";
import { setWebhook, setMyCommands, type BotCommand } from "../lib/telegram";
import { env } from "../lib/env";

const url = process.argv[2] ?? process.env.WEBHOOK_URL;
if (!url) {
  console.error("사용법: npm run setup:webhook -- https://<배포도메인>/api/telegram");
  process.exit(1);
}

const commands: BotCommand[] = [
  { command: "users", description: "유저 현황 (누적·오늘·어제 신규)" },
  { command: "threads", description: "최근 게시물 성과" },
  { command: "help", description: "도움말" },
];

const webhookResult = await setWebhook(url, env.TELEGRAM_WEBHOOK_SECRET);
console.log("setWebhook →", JSON.stringify(webhookResult));

const commandsResult = await setMyCommands(commands);
console.log("setMyCommands →", JSON.stringify(commandsResult));

console.log("\n완료. 텔레그램에서 /help 를 눌러 확인하세요.");
