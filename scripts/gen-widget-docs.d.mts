// Types for gen-widget-docs.mjs so vite.config.ts (type-checked) can import it.
export interface WidgetFieldDoc {
  text: string;
  doc: string;
}
export interface WidgetTypeDoc {
  doc: string;
  extends: string | null;
  fields: WidgetFieldDoc[];
}
export interface WidgetAliasDoc {
  doc: string;
  def: string;
}
export interface WidgetDocsData {
  generatedFrom: string;
  types: Record<string, WidgetTypeDoc>;
  aliases: Record<string, WidgetAliasDoc>;
  typeCount: number;
}
export function generateWidgetDocs(): WidgetDocsData;
export function writeWidgetDocs(): WidgetDocsData;
