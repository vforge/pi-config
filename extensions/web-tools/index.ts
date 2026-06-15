import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { parseHTML } from "linkedom";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// SearXNG config — reads SEARXNG_URL from root .env or environment
// ---------------------------------------------------------------------------
function loadEnv() {
  const home = process.env.HOME ?? "";
  const envPaths = [
    // package root: extensions/web-tools/index.ts -> ../../.env
    path.resolve(__dirname, "..", "..", ".env"),
    // backwards-compatible fallback for your current global setup
    path.join(home, ".pi", "agent", ".env"),
  ];

  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      // Prefer variables already exported by the shell.
      if (process.env[key] !== undefined) continue;
      const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      process.env[key] = value;
    }
  }
}

loadEnv();

function getSearxngUrl(): string {
  return (
    process.env.SEARXNG_URL ??
    "http://localhost:8080"
  ).replace(/\/+$/, ""); // trim trailing slash
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function searchSearxng(query: string, maxResults: number): Promise<SearchResult[]> {
  const baseUrl = getSearxngUrl();
  const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=auto`;

  const response = await fetch(url, { signal: undefined }); // ctx.signal passed below
  if (!response.ok) {
    throw new Error(`SearXNG returned ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  const results = (data.results ?? [])
    .slice(0, maxResults)
    .map((r, i) => ({
      title: r.title ?? "(no title)",
      url: r.url ?? "",
      snippet: (r.content ?? "").slice(0, 300),
    }));

  return results;
}

/** Strip HTML tags and collapse whitespace to produce readable plain text. */
function htmlToText(html: string): string {
  const { document } = parseHTML(html);
  const text = document.body?.textContent ?? "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[\t]+/g, " ")
    .replace(/[ ]{4,}/g, "   ") // collapse long runs but keep up to 3 spaces
    .replace(/\n{3,}/g, "\n\n");
}

async function fetchPage(url: string): Promise<{ title: string; text: string }> {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; pi-coding-agent/1.0)" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

  const contentType = response.headers.get("content-type") ?? "";
  let html = await response.text();

  // If it's JSON, return as-is
  if (contentType.includes("application/json")) {
    return { title: url, text: html.slice(0, 50_000) };
  }

  const { document } = parseHTML(html);
  const title = document.title || url;
  const text = htmlToText(html);

  return { title, text: text.slice(0, 50_000) };
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!process.env.SEARXNG_URL && getSearxngUrl().includes("localhost")) {
      ctx.ui.notify(
        "web-tools: SEARXNG_URL not set — defaults to http://localhost:8080",
        "info",
      );
    }
  });

  // ── web_search ────────────────────────────────────────────────────────────
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: "Search the web using SearXNG and return titles, URLs, and snippets.",
    promptSnippet: "Search the web for current information, documentation, or news.",
    promptGuidelines: [
      "Use web_search when the user asks about current events, recent releases, or topics that may not be in training data.",
      "Pass a concise query (3-8 words) to web_search for best results.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query (concise, 3-8 words recommended)" }),
      max_results: Type.Optional(
        Type.Integer({ default: 5, description: "Maximum number of results to return (default: 5, max: 20)" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const query = params.query;
      const maxResults = Math.min(params.max_results ?? 5, 20);

      onUpdate?.({ content: [{ type: "text", text: `Searching for "${query}"...` }] });

      try {
        const results = await searchSearxng(query, maxResults);

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: `No results found for "${query}".` }],
          };
        }

        const lines = results.map(
          (r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`,
        );

        return {
          content: [{
            type: "text",
            text: `Search results for "${query}" (${results.length} results):\n\n${lines.join("\n\n")}`,
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Search failed: ${msg}\n\nMake sure SEARXNG_URL is set and the SearXNG instance is reachable.` }],
          isError: true,
        };
      }
    },
  });

  // ── fetch_url ─────────────────────────────────────────────────────────────
  pi.registerTool({
    name: "fetch_url",
    label: "Fetch URL",
    description: "Fetch a web page and return its cleaned text content. Good for reading articles, docs, or any HTML page.",
    promptSnippet: "Fetch and read the text content of a web page.",
    promptGuidelines: [
      "Use fetch_url to read the full content of a specific URL (article, documentation page, etc.).",
      "fetch_url returns plain text — it does not execute JavaScript. For JS-heavy SPAs, prefer web_search snippets or look for a /api endpoint.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch (must include https://)" }),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const url = params.url;

      onUpdate?.({ content: [{ type: "text", text: `Fetching ${url}...` }] });

      try {
        const { title, text } = await fetchPage(url);

        return {
          content: [{
            type: "text",
            text: `--- Page: ${title} ---\nURL: ${url}\n\n${text}`,
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Failed to fetch ${url}: ${msg}` }],
          isError: true,
        };
      }
    },
  });
}
