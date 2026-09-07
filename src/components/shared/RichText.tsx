import { richTextHtml } from '../../lib/richText';

type RichTextProps = Readonly<{
  text: string;
  className?: string;
}>;

/** Inline rich text: `**bold**` spans and newlines rendered, everything else
 *  HTML-escaped by richTextHtml first — so user-typed text can never inject
 *  markup. The same rendering the scene labels use. */
export function RichText({ text, className }: RichTextProps) {
  return (
    <span
      className={className}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped by richTextHtml
      dangerouslySetInnerHTML={{ __html: richTextHtml(text) }}
    />
  );
}
