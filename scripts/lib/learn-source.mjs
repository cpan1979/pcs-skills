// Shared fetch + normalization logic for the four Microsoft Learn Solutions
// Partner pages. Used by both check-updates.mjs (drift detection) and
// reconcile-certifications.mjs (structured extraction).
import TurndownService from "turndown";

export const SOURCES = [
  { id: "business-applications", url: "https://learn.microsoft.com/en-us/partner-center/membership/solutions-partner-business" },
  { id: "azure",                  url: "https://learn.microsoft.com/en-us/partner-center/membership/solutions-partner-azure" },
  { id: "security",               url: "https://learn.microsoft.com/en-us/partner-center/membership/solutions-partner-security" },
  { id: "modern-work",            url: "https://learn.microsoft.com/en-us/partner-center/membership/solutions-partner-modern-work" }
];

export async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "PCSSkills-content-monitor/1.0 (+https://github.com/)",
      "Accept": "text/html,application/xhtml+xml"
    },
    redirect: "follow"
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return await res.text();
}

// Strip HTML chrome to focus on the article body. Microsoft Learn pages put
// the main article inside <main id="main"> with a <article> child.
export function extractMainHtml(html) {
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  let body = mainMatch ? mainMatch[1] : html;

  body = body
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<section[^>]*class="[^"]*feedback[^"]*"[\s\S]*?<\/section>/gi, "")
    .replace(/<section[^>]*data-bi-name="[^"]*feedback[^"]*"[\s\S]*?<\/section>/gi, "");

  return body;
}

export function normalizeMarkdown(md) {
  return md
    .replace(/^.*Last updated on .*$/gim, "")
    .replace(/^Summarize this article for me.*$/gim, "")
    .replace(/^.*Manage cookies.*$/gim, "")
    .replace(/^.*Microsoft Build 2026.*$/gim, "")
    .replace(/^.*Dismiss alert.*$/gim, "")
    .replace(/^.*Skip to main content.*$/gim, "")
    .replace(/^.*Ask Learn.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n").map((l) => l.replace(/\s+$/g, "")).join("\n")
    .trim() + "\n";
}

export function htmlToMarkdown(html) {
  const td = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced"
  });
  td.remove(["script", "style", "noscript", "iframe"]);
  return td.turndown(html);
}

export async function fetchNormalizedMarkdown(source) {
  const html = await fetchHtml(source.url);
  const main = extractMainHtml(html);
  return normalizeMarkdown(htmlToMarkdown(main));
}
