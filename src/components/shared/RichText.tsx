import { richTextHtml } from '../../lib/richText';

type RichTextProps = Readonly<{
  text: string;
  /** Render a block (`div`) instead of an inline `span` — for a paragraph of
   *  description rather than a run inside a row. */
  block?: boolean;
  className?: string;
}>;

/** Inline rich text: `**bold**` spans and newlines rendered, everything else
 *  HTML-escaped by richTextHtml first — so user-typed text can never inject
 *  markup. The same rendering the scene labels use. */
export function RichText({ text, block = false, className }: RichTextProps) {
  const Tag = block ? 'div' : 'span';
  return (
    <Tag
      className={className}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped by richTextHtml
      dangerouslySetInnerHTML={{ __html: richTextHtml(text) }}
    />
  );
}
