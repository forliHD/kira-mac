// Zeichnet den Knotenbaum aus markdown.ts als React-Elemente. Kein
// dangerouslySetInnerHTML: jeder Text geht als Textknoten in den DOM, Links
// öffnet der Hauptprozess (`openLink`), nie die Seite selbst.

import { type CSSProperties, type MouseEvent, type ReactNode, memo, useMemo } from "react";

import { ImageIcon } from "./icons";
import { type Block, type Inline, type ListItem, parseMarkdown, safeHref } from "./markdown";

interface Ctx {
  onLink: (href: string) => void;
}

export interface MarkdownViewProps {
  text: string;
  onLink: (href: string) => void;
  /** Blinkende Schreibmarke am Ende des letzten Textblocks (solange gestreamt wird). */
  caret?: boolean;
}

export const MarkdownView = memo(function MarkdownView({ text, onLink, caret = false }: MarkdownViewProps): ReactNode {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const ctx = useMemo<Ctx>(() => ({ onLink }), [onLink]);
  const trailing = caret ? <span className="q-caret" aria-hidden="true" /> : undefined;
  return (
    <div className="q-md">
      {blocks.map((block, i) => (
        <BlockView key={`${i}-${block.type}`} block={block} ctx={ctx} index={i} trailing={i === blocks.length - 1 ? trailing : undefined} />
      ))}
      {blocks.length === 0 ? trailing : null}
    </div>
  );
});

/** Neue Blöcke ziehen kurz auf (gestaffelt, gedeckelt – beim Streamen kommen sie einzeln). */
function rise(index: number): CSSProperties {
  return { "--q-rise-delay": `${Math.min(index, 6) * 40}ms` } as CSSProperties;
}

function BlockView({ block, ctx, index, trailing }: { block: Block; ctx: Ctx; index?: number; trailing?: ReactNode }): ReactNode {
  const style = index === undefined ? undefined : rise(index);
  const cls = index === undefined ? undefined : "q-rise";
  switch (block.type) {
    case "paragraph":
      return (
        <p className={cls} style={style}>
          <Inlines nodes={block.children} ctx={ctx} />
          {trailing}
        </p>
      );
    case "heading": {
      const Tag = block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4";
      return (
        <Tag className={`q-h q-h${block.level}${cls ? ` ${cls}` : ""}`} style={style}>
          <Inlines nodes={block.children} ctx={ctx} />
          {trailing}
        </Tag>
      );
    }
    case "code":
      return (
        <div className={`q-codeblock${cls ? ` ${cls}` : ""}`} style={style}>
          {block.lang ? <span className="q-codelang">{block.lang}</span> : null}
          {/* tabIndex: lange Zeilen lassen sich auch per Tastatur seitlich scrollen. */}
          <pre tabIndex={0} aria-label={block.lang ? `Code (${block.lang})` : "Code"}>
            <code>{block.text}</code>
          </pre>
          {trailing}
        </div>
      );
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i}>
          <ItemView item={item} ctx={ctx} trailing={i === block.items.length - 1 ? trailing : undefined} />
        </li>
      ));
      return block.ordered ? (
        <ol className={cls} style={style} start={block.start === 1 ? undefined : block.start}>
          {items}
        </ol>
      ) : (
        <ul className={cls} style={style}>
          {items}
        </ul>
      );
    }
    case "quote":
      return (
        <blockquote className={cls} style={style}>
          {block.children.map((child, i) => (
            <BlockView key={`${i}-${child.type}`} block={child} ctx={ctx} trailing={i === block.children.length - 1 ? trailing : undefined} />
          ))}
        </blockquote>
      );
    case "table":
      return (
        <div className={`q-table${cls ? ` ${cls}` : ""}`} style={style} tabIndex={0} role="group" aria-label="Tabelle">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, c) => (
                  <th key={c} style={{ textAlign: block.align[c] ?? undefined }} scope="col">
                    <Inlines nodes={cell} ctx={ctx} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} style={{ textAlign: block.align[c] ?? undefined }}>
                      <Inlines nodes={cell} ctx={ctx} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {trailing}
        </div>
      );
    case "rule":
      return <hr className={cls} style={style} />;
    default:
      return null;
  }
}

/** Ein Listenpunkt mit nur einem Absatz bleibt „eng“ (kein Absatzabstand). */
function ItemView({ item, ctx, trailing }: { item: ListItem; ctx: Ctx; trailing?: ReactNode }): ReactNode {
  const [first, ...rest] = item.blocks;
  if (!first) return trailing ?? null;
  if (first.type === "paragraph" && rest.length === 0) {
    return (
      <>
        <Inlines nodes={first.children} ctx={ctx} />
        {trailing}
      </>
    );
  }
  return (
    <>
      {first.type === "paragraph" ? (
        <span className="q-li-lead">
          <Inlines nodes={first.children} ctx={ctx} />
          {rest.length === 0 ? trailing : null}
        </span>
      ) : (
        <BlockView block={first} ctx={ctx} trailing={rest.length === 0 ? trailing : undefined} />
      )}
      {rest.map((block, i) => (
        <BlockView key={`${i}-${block.type}`} block={block} ctx={ctx} trailing={i === rest.length - 1 ? trailing : undefined} />
      ))}
    </>
  );
}

function Inlines({ nodes, ctx }: { nodes: Inline[]; ctx: Ctx }): ReactNode {
  return nodes.map((node, i) => <InlineView key={i} node={node} ctx={ctx} />);
}

function InlineView({ node, ctx }: { node: Inline; ctx: Ctx }): ReactNode {
  switch (node.type) {
    case "text":
      return node.text;
    case "break":
      return <br />;
    case "code":
      return <code className="q-icode">{node.text}</code>;
    case "strong":
      return (
        <strong>
          <Inlines nodes={node.children} ctx={ctx} />
        </strong>
      );
    case "em":
      return (
        <em>
          <Inlines nodes={node.children} ctx={ctx} />
        </em>
      );
    case "del":
      return (
        <del>
          <Inlines nodes={node.children} ctx={ctx} />
        </del>
      );
    case "link":
      return (
        <Link href={node.href} ctx={ctx}>
          <Inlines nodes={node.children} ctx={ctx} />
        </Link>
      );
    case "image": {
      const label = `Bild: ${node.alt || "ohne Beschreibung"}`;
      return node.href ? (
        <Link href={node.href} ctx={ctx} className="q-imglink">
          <ImageIcon size={13} />
          {label}
        </Link>
      ) : (
        <span className="q-imglink">
          <ImageIcon size={13} />
          {label}
        </span>
      );
    }
    default:
      return null;
  }
}

function Link({ href, ctx, className, children }: { href: string; ctx: Ctx; className?: string; children: ReactNode }): ReactNode {
  // Zweite Sicherung: nur, was safeHref unverändert durchlässt, wird ein Link.
  if (safeHref(href) !== href) return <span className={className}>{children}</span>;
  const open = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    ctx.onLink(href);
  };
  return (
    <a
      className={`q-link${className ? ` ${className}` : ""}`}
      href={href}
      title={href}
      rel="noreferrer noopener"
      draggable={false}
      onClick={open}
      // Mittlere Maustaste würde sonst ein neues Fenster anfordern.
      onAuxClick={(event) => event.preventDefault()}
    >
      {children}
    </a>
  );
}
