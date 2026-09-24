import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";
import MiniSearch from "minisearch";

export interface RuleChunk {
  id: string;
  source: string;
  title: string;
  breadcrumb: string;
  text: string;
}

const SKIP_FILES = new Set(["LICENSE.md", "README.md"]);
const MAX_CHUNK = 4000;

/** Convert the SRD's HTML ability tables to one compact line, strip other tags. */
export function cleanMarkdown(md: string): string {
  return md
    .replace(/<table>[\s\S]*?<\/table>/g, (table) => {
      const cells = [...table.matchAll(/<t[dh]>([\s\S]*?)<\/t[dh]>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
      const abil = cells.join(" ").match(/\b(STR|DEX|CON|INT|WIS|CHA) (\d+) ([+−-]\d+) ([+−-]\d+)/g);
      if (abil) return abil.map((a) => a.replace(/^(\w+) (\d+) (\S+) (\S+)$/, "$1 $2 ($3, save $4)")).join("; ");
      return cells.filter(Boolean).join(" | ");
    })
    .replace(/<br\s*\/?>/g, "")
    .replace(/<hr\s*\/?>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split markdown into chunks at headings (h1-h4), carrying a breadcrumb of parent headings. */
export function chunkMarkdown(source: string, md: string): RuleChunk[] {
  const lines = md.split("\n");
  const chunks: RuleChunk[] = [];
  const stack: string[] = [];
  let title = basename(source, extname(source));
  let buf: string[] = [];
  const flush = () => {
    const text = cleanMarkdown(buf.join("\n"));
    buf = [];
    if (!text) return;
    const breadcrumb = [basename(source, extname(source)), ...stack.slice(0, -1)].join(" > ");
    for (let i = 0; i < text.length; i += MAX_CHUNK) {
      chunks.push({ id: `${source}#${chunks.length}`, source, title, breadcrumb, text: text.slice(i, i + MAX_CHUNK) });
    }
  };
  for (const line of lines) {
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      // Keep monster/spell stat blocks whole: "#### Actions" etc. stay inside their "### Name" chunk.
      if (level >= 3 && isStatBlockSubsection(h[2])) {
        buf.push(`${h[2]}:`);
        continue;
      }
      flush();
      stack.length = level - 1;
      stack[level - 1] = h[2].trim();
      title = h[2].trim();
      continue;
    }
    buf.push(line);
  }
  flush();
  return chunks;
}

const STAT_SUBSECTIONS = new Set(["Traits", "Actions", "Bonus Actions", "Reactions", "Legendary Actions"]);
function isStatBlockSubsection(h: string) {
  return STAT_SUBSECTIONS.has(h.trim());
}

function chunkPlainText(source: string, text: string): RuleChunk[] {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: RuleChunk[] = [];
  let cur = "";
  const push = () => {
    if (!cur) return;
    const firstLine = cur.split("\n")[0].slice(0, 80);
    chunks.push({ id: `${source}#${chunks.length}`, source, title: firstLine, breadcrumb: basename(source), text: cur });
    cur = "";
  };
  for (const p of paras) {
    if (cur.length + p.length > 1500) push();
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  push();
  return chunks;
}

export class RulesIndex {
  private search: MiniSearch<RuleChunk>;
  readonly chunks: RuleChunk[] = [];

  constructor() {
    this.search = new MiniSearch<RuleChunk>({
      fields: ["title", "breadcrumb", "text"],
      storeFields: ["id"],
      searchOptions: { boost: { title: 4, breadcrumb: 1.5 }, prefix: true, fuzzy: 0.15, combineWith: "OR" },
    });
  }

  add(chunks: RuleChunk[]) {
    this.chunks.push(...chunks);
    this.search.addAll(chunks);
  }

  loadSrd(dir: string) {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith(".md") || SKIP_FILES.has(f)) continue;
      this.add(chunkMarkdown(`srd/${f}`, readFileSync(join(dir, f), "utf8")));
    }
  }

  async loadCustom(dir: string) {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir).sort()) {
      const path = join(dir, f);
      const ext = extname(f).toLowerCase();
      if (ext === ".md") this.add(chunkMarkdown(`custom/${f}`, readFileSync(path, "utf8")));
      else if (ext === ".txt") this.add(chunkPlainText(`custom/${f}`, readFileSync(path, "utf8")));
      else if (ext === ".pdf") {
        // Import the inner module: pdf-parse's index runs a debug harness on import.
        const { default: pdf } = (await import("pdf-parse/lib/pdf-parse.js" as string)) as {
          default: (b: Buffer) => Promise<{ text: string }>;
        };
        const { text } = await pdf(readFileSync(path));
        this.add(chunkPlainText(`custom/${f}`, text));
      }
    }
  }

  /** Top matches; custom (house) rules are boosted so they win over the SRD. */
  query(q: string, limit = 3): RuleChunk[] {
    const byId = new Map(this.chunks.map((c) => [c.id, c]));
    const results = this.search.search(q, {
      boostDocument: (id) => (String(id).startsWith("custom/") ? 1.5 : 1),
    });
    return results.slice(0, limit).map((r) => byId.get(String(r.id))!).filter(Boolean);
  }

  /** Model-facing lookup: trimmed text of the best matches. */
  lookup(q: string, limit = 3, maxChars = 2500): string {
    const hits = this.query(q, limit);
    if (!hits.length) return `No rule found for "${q}". Make a fair ruling and move on.`;
    let out = "";
    for (const h of hits) {
      const block = `## ${h.title} (${h.source}${h.source.startsWith("custom/") ? ", HOUSE RULE" : ""})\n${h.text}\n\n`;
      if (out.length + block.length > maxChars) {
        out += block.slice(0, Math.max(0, maxChars - out.length));
        break;
      }
      out += block;
    }
    return out.trim();
  }
}
