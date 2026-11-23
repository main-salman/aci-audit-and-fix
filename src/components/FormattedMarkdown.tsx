"use client";

import React from "react";

/**
 * Full-featured Markdown renderer for AI ChatOps messages.
 * Properly formats headings (###, ##, #), Markdown tables (| col | col |),
 * bullet lists (- / * / 1.), bold text (**bold**), inline code (`code`), and code blocks (```).
 */
export function FormattedMarkdown({
  content,
  isUser = false,
}: {
  content: string;
  isUser?: boolean;
}) {
  if (!content) return null;

  // Split by fenced code blocks first
  const segments = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-2.5 leading-relaxed">
      {segments.map((segment, segIdx) => {
        if (segment.startsWith("```") && segment.endsWith("```")) {
          const lines = segment.slice(3, -3).trim().split("\n");
          const firstLine = lines[0] || "";
          const codeBody =
            /^[a-zA-Z0-9_-]+$/.test(firstLine) && lines.length > 1
              ? lines.slice(1).join("\n")
              : lines.join("\n");
          return (
            <pre
              key={segIdx}
              className="p-2.5 rounded-lg bg-slate-900 text-sky-200 font-mono text-[11px] overflow-x-auto border border-slate-700"
            >
              {codeBody}
            </pre>
          );
        }

        const lines = segment.split("\n");
        const elements: React.ReactNode[] = [];
        let listItems: React.ReactNode[] = [];
        let tableLines: string[] = [];

        const flushList = (keyPrefix: string) => {
          if (listItems.length > 0) {
            elements.push(
              <ul
                key={`${keyPrefix}-list`}
                className="space-y-1.5 pl-4 list-disc marker:text-[#049fd9]"
              >
                {listItems}
              </ul>
            );
            listItems = [];
          }
        };

        const flushTable = (keyPrefix: string) => {
          if (tableLines.length >= 2) {
            const parseRow = (row: string) =>
              row
                .trim()
                .replace(/^\||\|$/g, "")
                .split("|")
                .map((cell) => cell.trim());

            const headers = parseRow(tableLines[0]);
            const bodyRows = tableLines
              .slice(1)
              .filter((r) => !/^[\s|:-]+$/.test(r))
              .map(parseRow);

            elements.push(
              <div
                key={`${keyPrefix}-table`}
                className="overflow-x-auto rounded-lg border border-slate-200 my-2"
              >
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-slate-800">
                      {headers.map((h, hIdx) => (
                        <th
                          key={hIdx}
                          className="px-2.5 py-1.5 font-bold whitespace-nowrap"
                        >
                          {renderInlineTokens(h, false)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {bodyRows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-slate-50/80">
                        {row.map((cell, cIdx) => (
                          <td
                            key={cIdx}
                            className="px-2.5 py-1.5 align-top text-slate-700"
                          >
                            {renderInlineTokens(cell, false)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          tableLines = [];
        };

        lines.forEach((rawLine, lineIdx) => {
          const line = rawLine.trim();
          if (!line) {
            flushList(`${segIdx}-${lineIdx}`);
            flushTable(`${segIdx}-${lineIdx}`);
            return;
          }

          // Detect Markdown Table rows
          if (line.startsWith("|") && line.endsWith("|")) {
            flushList(`${segIdx}-${lineIdx}`);
            tableLines.push(line);
            return;
          } else if (tableLines.length > 0) {
            flushTable(`${segIdx}-${lineIdx}`);
          }

          // Ignore horizontal rules
          if (/^---+$/.test(line)) {
            flushList(`${segIdx}-${lineIdx}`);
            return;
          }

          // Headings
          if (line.startsWith("### ") || line.startsWith("#### ")) {
            flushList(`${segIdx}-${lineIdx}`);
            const text = line.replace(/^#+\s*/, "");
            elements.push(
              <h4
                key={`${segIdx}-${lineIdx}`}
                className={`text-xs font-bold tracking-tight pt-1.5 ${
                  isUser ? "text-white" : "text-[#0d274d]"
                }`}
              >
                {renderInlineTokens(text, isUser)}
              </h4>
            );
            return;
          }
          if (line.startsWith("## ") || line.startsWith("# ")) {
            flushList(`${segIdx}-${lineIdx}`);
            const text = line.replace(/^#+\s*/, "");
            elements.push(
              <h3
                key={`${segIdx}-${lineIdx}`}
                className={`text-sm font-bold tracking-tight pt-1 border-b pb-1 ${
                  isUser
                    ? "text-white border-white/20"
                    : "text-[#0d274d] border-slate-200"
                }`}
              >
                {renderInlineTokens(text, isUser)}
              </h3>
            );
            return;
          }

          // Bullet or numbered list items
          const bulletMatch = line.match(/^([-*•]|\d+\.)\s+(.*)$/);
          if (bulletMatch) {
            listItems.push(
              <li key={`${segIdx}-${lineIdx}`} className="leading-relaxed">
                {renderInlineTokens(bulletMatch[2], isUser)}
              </li>
            );
            return;
          }

          flushList(`${segIdx}-${lineIdx}`);
          elements.push(
            <p key={`${segIdx}-${lineIdx}`} className="leading-relaxed">
              {renderInlineTokens(line, isUser)}
            </p>
          );
        });

        flushList(`${segIdx}-end`);
        flushTable(`${segIdx}-end`);
        return <React.Fragment key={segIdx}>{elements}</React.Fragment>;
      })}
    </div>
  );
}

function renderInlineTokens(text: string, isUser: boolean): React.ReactNode[] {
  // Tokenize by bold-code (**`...`**), inline code (`...`), bold (**...**), and italic (*...*)
  const parts = text.split(/(\*\*`[^`]+`\*\*|`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (
      part.startsWith("**`") &&
      part.endsWith("`**") &&
      part.length > 6
    ) {
      return (
        <code
          key={idx}
          className={`px-1.5 py-0.5 rounded font-mono text-[11px] font-bold ${
            isUser
              ? "bg-white/20 text-white"
              : "bg-sky-100 text-[#0369a1] border border-sky-300"
          }`}
        >
          {part.slice(3, -3)}
        </code>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={idx}
          className={`px-1.5 py-0.5 rounded font-mono text-[11px] font-semibold ${
            isUser
              ? "bg-white/20 text-white"
              : "bg-sky-50 text-[#0284c7] border border-sky-200/80"
          }`}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong
          key={idx}
          className={`font-bold ${isUser ? "text-white" : "text-slate-900"}`}
        >
          {renderInlineTokens(part.slice(2, -2), isUser)}
        </strong>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}
