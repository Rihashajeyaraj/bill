const listeners = new Set();
const activeTokens = new Set();
let routeLoading = false;

function emit() {
  listeners.forEach((listener) => {
    listener();
  });
}

export function subscribePageLoading(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function beginPageLoading(scope = "global") {
  const token = `${scope}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  activeTokens.add(token);
  emit();
  return token;
}

export function endPageLoading(token) {
  if (!token) return;
  if (!activeTokens.has(token)) return;
  activeTokens.delete(token);
  emit();
}

export function setRouteLoading(next) {
  const value = Boolean(next);
  if (routeLoading === value) return;
  routeLoading = value;
  emit();
}

export function getPageLoadingSnapshot() {
  const pendingCount = activeTokens.size;
  return {
    pendingCount,
    routeLoading,
    isLoading: routeLoading || pendingCount > 0
  };
}

export async function withPageLoading(task, scope = "global") {
  const token = beginPageLoading(scope);
  try {
    return await task();
  } finally {
    endPageLoading(token);
  }
}
