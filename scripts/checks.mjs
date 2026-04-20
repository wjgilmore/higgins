export async function ollamaReachable(url, apiFormat = "auto") {
  const format = apiFormat.toLowerCase();

  // Try Ollama native
  if (format === "ollama" || format === "auto") {
    try {
      const res = await fetch(`${url}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        const models = (data.models ?? []).map((m) => m.name);
        return { ok: true, models, detectedFormat: "ollama" };
      }
    } catch (err) {
      if (format === "ollama") return { ok: false, error: err.message };
    }
  }

  // Try OpenAI-compatible
  if (format === "openai" || format === "auto") {
    try {
      const res = await fetch(`${url}/v1/models`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        const models = (data.data ?? []).map((m) => m.id);
        return { ok: true, models, detectedFormat: "openai" };
      }
    } catch (err) {
      if (format === "openai") return { ok: false, error: err.message };
    }
  }

  return { ok: false, error: "LLM server not reachable (tried Ollama and OpenAI endpoints)" };
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
