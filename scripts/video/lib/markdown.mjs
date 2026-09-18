/**
 * The handful of Markdown constructs the video panels actually need.
 *
 * Deliberately not a Markdown parser. The video renders four things — fenced code
 * blocks, pipe tables, headings, and inline code — and pulling in an HTML sanitiser
 * and a full CommonMark implementation to draw those would put a dependency in the
 * repository for a build tool that runs on one machine. What is here is small enough
 * to read in full, which matters more for a tool nobody will maintain.
 */

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Split a Markdown document into top-level sections keyed by heading text. */
export function sections(markdown) {
  const out = [];
  let current = null;
  for (const line of markdown.split("\n")) {
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (level <= 2) {
        current = { heading: stripInline(heading[2]), level, body: [] };
        out.push(current);
        continue;
      }
    }
    if (current) current.body.push(line);
  }
  return out.map((s) => ({ ...s, body: s.body.join("\n") }));
}

/** Remove inline Markdown emphasis and code ticks, leaving readable text. */
export function stripInline(text) {
  return String(text)
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

/**
 * Render a pipe table to HTML.
 *
 * Alignment comes from the separator row, which is the only place Markdown records
 * it; without honouring it a column of numbers renders left-aligned and the one
 * thing a benchmark table has to communicate — magnitude — is unreadable.
 */
export function renderTable(rows) {
  const split = (line) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  const header = split(rows[0]);
  const separators = split(rows[1]);
  const align = separators.map((s) => {
    const left = s.startsWith(":");
    const right = s.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });

  const body = rows.slice(2).map(split);
  const cell = (content, i, tag) => {
    const a = align[i] ?? "left";
    const text = stripInline(content).replace(/<br\s*\/?>/gi, " ");
    return `<${tag} class="al-${a}">${escapeHtml(text)}</${tag}>`;
  };

  const head = header.map((h, i) => cell(h, i, "th")).join("");
  const bodyHtml = body
    .map((r) => `<tr>${r.map((c, i) => cell(c, i, "td")).join("")}</tr>`)
    .join("\n");

  return `<table><thead><tr>${head}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
}

/**
 * Pull the rows of the first pipe table in `text` that follows `heading`.
 *
 * Returns `null` rather than throwing: a panel whose source table moved is a broken
 * panel, and the caller should fail with a message naming the file and the heading
 * rather than a stack trace from inside a regex.
 */
export function tableRowsAfterHeading(markdown, heading) {
  const lines = markdown.split("\n");
  let index = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.includes(heading));
  if (index === -1) return null;

  const rows = [];
  for (index += 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (rows.length && line.trim() === "") break;
    if (/^\s*\|.*\|\s*$/.test(line)) {
      rows.push(line);
    } else if (rows.length) {
      break;
    }
  }
  return rows.length >= 2 ? rows : null;
}

/** Extract every fenced code block, optionally filtered by language. */
export function fences(markdown, language) {
  const out = [];
  const re = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let match;
  while ((match = re.exec(markdown)) !== null) {
    if (!language || match[1] === language) out.push(match[2]);
  }
  return out;
}

/** The first line of the first paragraph under a heading, for a standfirst. */
export function firstParagraphAfterHeading(markdown, heading) {
  const lines = markdown.split("\n");
  const at = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.includes(heading));
  if (at === -1) return "";
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#") || line.startsWith("|") || line.startsWith(">")) continue;
    return stripInline(line);
  }
  return "";
}
