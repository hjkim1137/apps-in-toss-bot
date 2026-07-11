// 로컬에서 다이제스트를 미리보고(선택적으로) 텔레그램에 발송. (§7 1단계 수동 검증)
// 미리보기:  npm run preview:digest
// 실제 발송:  npm run send:digest
import "dotenv/config";
import { buildDigest } from "../lib/digest";
import { sendMessage } from "../lib/telegram";
import { env } from "../lib/env";

const shouldSend = process.argv.includes("--send");

const text = await buildDigest();
console.log("\n----- 다이제스트 미리보기 -----\n");
console.log(text);
console.log("\n------------------------------\n");

if (shouldSend) {
  await sendMessage(env.TELEGRAM_CHAT_ID, text);
  console.log("텔레그램으로 발송했어요.");
} else {
  console.log("발송하려면 --send 플래그를 붙이세요 (npm run send:digest).");
}
