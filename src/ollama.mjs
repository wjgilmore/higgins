export class Ollama {
  constructor({ url, model }) {
    this.url = url;
    this.model = model;
    this.supportsTools = null;
  }

  async chat({ messages, tools, useNative = true }) {
    const body = { model: this.model, messages, stream: false };
    if (useNative && tools && tools.length > 0) body.tools = tools;
    const res = await fetch(`${this.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama chat failed (${res.status}): ${text}`);
    }
    return res.json();
  }

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
      console.error("[ollama] Tool probe failed:", err.message);
      this.supportsTools = false;
    }
    return this.supportsTools;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { config } = await import("./config.mjs");
  const ol = new Ollama(config.ollama);
  const ok = await ol.probeToolSupport();
  console.log(`Tool-calling support for ${config.ollama.model}: ${ok}`);
}
