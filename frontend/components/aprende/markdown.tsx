"use client";

/**
 * Mini renderer de Markdown para las lecciones de Aprende UNIDATA.
 * Soporta: ### headers, **bold**, `inline code`, listas con -, links [text](url),
 * y bloques de codigo con ```.
 * NO usamos react-markdown para no sumar dependencia.
 */

type Token =
  | { type: "h3"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "code"; text: string };

function tokenize(md: string): Token[] {
  const lines = md.split("\n");
  const out: Token[] = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.startsWith("### ")) {
      out.push({ type: "h3", text: ln.slice(4).trim() });
      i++;
      continue;
    }
    if (ln.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      out.push({ type: "code", text: buf.join("\n") });
      continue;
    }
    if (ln.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) {
        items.push(lines[i].slice(2).trim());
        i++;
      }
      out.push({ type: "ul", items });
      continue;
    }
    if (ln.trim() === "") {
      i++;
      continue;
    }
    // Parrafo: tomar lineas consecutivas no especiales
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("### ") &&
      !lines[i].startsWith("- ") &&
      !lines[i].startsWith("```")
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push({ type: "p", text: buf.join(" ") });
  }
  return out;
}

function renderInline(text: string): React.ReactNode[] {
  // Procesar inline en orden: bold > code > links > plain
  const parts: React.ReactNode[] = [];
  let rest = text;
  let key = 0;
  // Regex: matches **bold**, `code`, [link](url) — usamos non-greedy.
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/;
  while (rest.length > 0) {
    const m = rest.match(regex);
    if (!m || m.index === undefined) {
      parts.push(<span key={key++}>{rest}</span>);
      break;
    }
    if (m.index > 0) {
      parts.push(<span key={key++}>{rest.slice(0, m.index)}</span>);
    }
    const token = m[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      parts.push(
        <code
          key={key++}
          className="bg-bg-muted text-text px-1 py-0.5 rounded text-[0.85em] font-mono"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("[")) {
      const closeBracket = token.indexOf("]");
      const label = token.slice(1, closeBracket);
      const url = token.slice(closeBracket + 2, -1);
      const isExternal = url.startsWith("http");
      parts.push(
        <a
          key={key++}
          href={url}
          target={isExternal ? "_blank" : undefined}
          rel={isExternal ? "noreferrer" : undefined}
          className="text-primary hover:underline font-semibold"
        >
          {label}
        </a>,
      );
    }
    rest = rest.slice(m.index + token.length);
  }
  return parts;
}

export function LessonMarkdown({ content }: { content: string }) {
  const tokens = tokenize(content);
  return (
    <div className="prose-content text-sm leading-relaxed text-text space-y-3">
      {tokens.map((t, i) => {
        if (t.type === "h3") {
          return (
            <h3 key={i} className="text-base font-bold mt-4 mb-1 text-text">
              {renderInline(t.text)}
            </h3>
          );
        }
        if (t.type === "ul") {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1 text-[13px]">
              {t.items.map((it, j) => (
                <li key={j}>{renderInline(it)}</li>
              ))}
            </ul>
          );
        }
        if (t.type === "code") {
          return (
            <pre
              key={i}
              className="bg-bg-muted border border-border rounded-lg p-3 text-[12px] font-mono overflow-x-auto"
            >
              <code>{t.text}</code>
            </pre>
          );
        }
        return (
          <p key={i} className="text-[13px]">
            {renderInline(t.text)}
          </p>
        );
      })}
    </div>
  );
}
