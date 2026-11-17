// Types for gen-api-docs.mjs so vite.config.ts (type-checked) can import it.
export interface ApiMethodDoc {
  name: string;
  command: string | null;
  signature: string;
  doc: string;
  example: string | null;
  sample: string | null;
}
export interface ApiGroup {
  ns: string;
  methods: ApiMethodDoc[];
}
export interface ApiTypeDoc {
  name: string;
  doc: string;
  fields: { text: string; doc: string }[];
}
export interface ApiDocsData {
  protocol: string | null;
  generatedFrom: string;
  methodCount: number;
  groups: ApiGroup[];
  types: ApiTypeDoc[];
  problems: string[];
}
export function generateApiDocs(): ApiDocsData;
export function writeApiDocs(): ApiDocsData;
/** Product page: `{{apiNamespaceCount}}` → the namespace count; every
 *  namespace needs a `data-ns` tile and every tile must be a namespace. */
export function applyApiNamespaces(
  html: string,
  data: Pick<ApiDocsData, 'groups'>,
): { html: string; problems: string[] };
