// 兼容旧浏览器（iOS Safari < 15.4、部分安卓 WebView 不支持 AbortSignal.any）：
// 手动组合「外部 signal + 超时」为一个新的 AbortSignal。
// 外部 signal 中止或超时到达时，返回的 signal 都会中止。
export function withTimeout(
  signal: AbortSignal | undefined,
  ms: number,
): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  // 一旦返回的 signal 中止（超时或外部中止），清理定时器与监听，避免泄漏
  controller.signal.addEventListener("abort", () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  });
  return controller.signal;
}
