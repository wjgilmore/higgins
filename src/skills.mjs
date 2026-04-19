import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function loadSkills(dir, { enabled } = {}) {
  const skills = [];
  const allowList = enabled && enabled.length > 0 ? new Set(enabled) : null;

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (allowList && !allowList.has(entry)) continue;

    const skillPath = join(full, "skill.mjs");
    try {
      statSync(skillPath);
    } catch {
      continue;
    }
    const mod = await import(pathToFileURL(skillPath).href);
    const exported = mod.default ?? mod;
    const items = Array.isArray(exported) ? exported : [exported];
    for (const s of items) {
      if (!s?.name || typeof s?.handler !== "function") {
        console.warn(`[skills] Skipping invalid skill at ${skillPath}`);
        continue;
      }
      skills.push({ ...s, skillDir: full });
    }
  }
  return skills;
}

export function asOllamaTools(skills) {
  return skills.map((s) => ({
    type: "function",
    function: {
      name: s.name,
      description: s.description ?? "",
      parameters: s.parameters ?? { type: "object", properties: {} },
    },
  }));
}
