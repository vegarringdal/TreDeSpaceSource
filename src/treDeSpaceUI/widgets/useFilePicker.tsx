import { type ReactNode, useRef } from 'react';

/** A hidden `<input type=file>` + an `open()` trigger — the shared piece of
 *  every panel's Load… button. Render `element` anywhere in the tree. */
export function useFilePicker(
  accept: string,
  onFile: (file: File) => void,
): { element: ReactNode; open: () => void; ref: React.RefObject<HTMLInputElement | null> } {
  const ref = useRef<HTMLInputElement>(null);
  const element = (
    <input
      ref={ref}
      type="file"
      accept={accept}
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) {
          onFile(f);
        }
        e.target.value = '';
      }}
    />
  );
  return { element, open: () => ref.current?.click(), ref };
}

/** Same as useFilePicker, but the user can pick SEVERAL files at once (SQL
 *  Assets → Import Database). `onFiles` never gets an empty list. */
export function useMultiFilePicker(
  accept: string,
  onFiles: (files: File[]) => void,
): { element: ReactNode; open: () => void; ref: React.RefObject<HTMLInputElement | null> } {
  const ref = useRef<HTMLInputElement>(null);
  const element = (
    <input
      ref={ref}
      type="file"
      accept={accept}
      multiple
      className="hidden"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        if (files.length) {
          onFiles(files);
        }
        e.target.value = '';
      }}
    />
  );
  return { element, open: () => ref.current?.click(), ref };
}

/** Read a picked file as text and hand it to `onText`; parse errors are the
 *  caller's job (they usually show a dialog). */
export function readFileText(file: File, onText: (text: string) => void) {
  const reader = new FileReader();
  reader.onload = () => onText(String(reader.result));
  reader.readAsText(file);
}
