// ops_kv: 배포 없이 바뀌는 상태(갱신 토큰 등) 저장소.
// 뺄래낼래 Supabase 프로젝트의 public.ops_kv 테이블을 service role 로 접근한다(§4-4).
import { plnlSupabase } from "./supabase";

const TABLE = "ops_kv";

export async function kvGet(key: string): Promise<string | null> {
  const { data, error } = await plnlSupabase()
    .from(TABLE)
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return (data?.value as string | undefined) ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  const { error } = await plnlSupabase()
    .from(TABLE)
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
}
