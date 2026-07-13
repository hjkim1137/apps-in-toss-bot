// Meta 그래프 인사이트 응답에서 수치 하나를 뽑는다. Threads·Instagram 공용.
// 신형(total_value.value)·구형(values[0].value) 두 포맷을 모두 지원.
export interface InsightItem {
  name?: string;
  total_value?: { value?: number };
  values?: Array<{ value?: number }>;
}

export function extractInsightValue(item: InsightItem): number {
  if (item?.total_value?.value != null) return item.total_value.value;
  const v = item?.values?.[0]?.value;
  return v != null ? v : 0;
}
