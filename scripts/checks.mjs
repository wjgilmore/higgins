export async function ollamaReachable(url) {
  try {
    const res = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    const models = (data.models ?? []).map((m) => m.name);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function telegramReachable(token) {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getMe`,
      { signal: AbortSignal.timeout(5000) },
    );
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.description ?? "unknown" };
    return { ok: true, botUsername: data.result.username };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function nodeVersionOk(min = 20) {
  const major = parseInt(process.versions.node.split(".")[0], 10);
  return { ok: major >= min, version: process.versions.node };
}
