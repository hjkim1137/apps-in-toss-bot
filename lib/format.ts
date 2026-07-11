// ko-KR 정수 포맷 (1234 → "1,234"). digest/commands 공용.
export const fmt = (n: number) => n.toLocaleString("ko-KR");
