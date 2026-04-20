/**
 * LLM client supporting both Ollama native and OpenAI-compatible APIs.
 *
 * API format is controlled by the `apiFormat` constructor option:
 *   - "ollama"  — Ollama native (/api/chat, /api/tags)
 *   - "openai"  — OpenAI-compatible (/v1/chat/completions, /v1/models)
 *   - "auto"    — probe the server and pick whichever responds (default)
 *
 * The chat() method always returns a normalized Ollama-shaped response
 * ({ message: { role, content, tool_calls } }) regardless of backend,
 * so the Agent doesn't need to know which format is in use.
 */
export class Ollama {
  constructor({ url, model, apiFormat = "auto" }) {
    this.url = url;
    this.model = model;
    this.requestedFormat = apiFormat.toLowerCase();
    this.resolvedFormat = null; // set after first call or probe
    this.supportsTools = null;
  }

  // --- Format detection ---

  async detectFormat() {
    if (this.resolvedFormat) return this.resolvedFormat;

    if (this.requestedFormat === "ollama" || this.requestedFormat === "openai") {
      this.resolvedFormat = this.requestedFormat;
      return this.resolvedFormat;
    }

    // Auto-detect: try Ollama first (more common), fall back to OpenAI
    try {
      const res = await fetch(`${this.url}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        this.resolvedFormat = "ollama";
        return this.resolvedFormat;
      }
    } catch {}

    try {
      const res = await fetch(`${this.url}/v1/models`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        this.resolvedFormat = "openai";
        return this.resolvedFormat;
      }
    } catch {}

    // Default to ollama if neither responded
    console.warn("[llm] Auto-detect failed, defaulting to ollama format");
    this.resolvedFormat = "ollama";
    return this.resolvedFormat;
  }

  // --- Chat ---

  async chat({ messages, tools, useNative = true }) {
    const format = await this.detectFormat();
    const endpoint = format === "openai"
      ? `${this.url}/v1/chat/completions`
      : `${this.url}/api/chat`;
    const body = { model: this.model, messages, stream: false };
    if (useNative && tools && tools.length > 0) body.tools = tools;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`LLM chat failed (${res.status}): ${text}`);
    }
    return this._normalizeResponse(await res.json());
  }

  // Normalize any response shape to { message: { role, content, tool_calls } }.
  // Handles: Ollama native ({ message }), OpenAI ({ choices }), and servers
  // like llama.cpp that serve Ollama URL paths but return OpenAI-shaped JSON.
  _normalizeResponse(data) {
    let msg;
    if (data.message && !data.choices) {
      // Pure Ollama format
      msg = data.message;
    } else if (data.choices) {
      // OpenAI format (or llama.cpp hybrid)
      msg = data.choices[0]?.message ?? {};
    } else {
      msg = {};
    }
    // Normalize tool_calls — OpenAI returns arguments as a JSON string,
    // Ollama returns them as an object. Standardize to parsed objects.
    if (Array.isArray(msg.tool_calls)) {
      msg.tool_calls = msg.tool_calls.map((tc) => ({
        function: {
          name: tc.function?.name,
          arguments: typeof tc.function?.arguments === "string"
            ? tryParse(tc.function.arguments)
            : tc.function?.arguments ?? {},
        },
      }));
    }
    return { message: msg };
  }

  // --- Model listing ---

  async listModels() {
    const format = await this.detectFormat();
    if (format === "openai") return this._listModelsOpenAI();
    return this._listModelsOllama();
  }

  async _listModelsOllama() {
    const res = await fetch(`${this.url}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models ?? []).map((m) => m.name);
  }

  async _listModelsOpenAI() {
    const res = await fetch(`${this.url}/v1/models`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data ?? []).map((m) => m.id);
  }

  // --- Tool support probe ---

  async probeToolSupport() {
    if (this.supportsTools !== null) return this.supportsTools;
    const pingTool = {
      type: "function",
      function: {
        name: "ping",
        description: "Returns pong. Call this to verify tool use works.",
        parameters: { type: "object", properties: {} },
      },
    };
    try {
      const res = await this.chat({
        messages: [
          {
            role: "user",
            content:
              "Invoke the `ping` tool. Do not reply with text — call the tool.",
          },
        ],
        tools: [pingTool],
      });
      const calls = res?.message?.tool_calls;
      this.supportsTools = Array.isArray(calls) && calls.length > 0;
    } catch (err) {
      console.error("[llm] Tool probe failed:", err.message);
      this.supportsTools = false;
    }
    return this.supportsTools;
  }
}

function tryParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { config } = await import("./config.mjs");
  const ol = new Ollama(config.ollama);
  const format = await ol.detectFormat();
  console.log(`Detected API format: ${format}`);
  const ok = await ol.probeToolSupport();
  console.log(`Tool-calling support for ${config.ollama.model}: ${ok}`);
}
