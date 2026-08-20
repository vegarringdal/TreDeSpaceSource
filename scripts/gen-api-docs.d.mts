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
