import type { ReactNode } from "react";

// Render plain text with any http(s) URLs as clickable links (new tab). The system's SMS bodies
// carry tokenized form/action links as bare text — this keeps the surrounding text verbatim
// (works inside whitespace-pre-wrap) and never injects HTML: the text is split and rebuilt as
// React nodes. Trailing sentence punctuation stays outside the link ("... report: <url>." ).
const URL_RE = /https?:\/\/[^\s<>"]+/g;
const TRAILING_PUNCT = /[.,;:!?)\]'"]+$/;

export function linkify(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    let url = match[0];
    const trail = TRAILING_PUNCT.exec(url);
    if (trail) url = url.slice(0, url.length - trail[0].length);
    if (!url) continue;
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    nodes.push(
      <a
        key={`${start}:${url}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-primary underline underline-offset-2 hover:opacity-80"
      >
        {url}
      </a>,
    );
    last = start + url.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
