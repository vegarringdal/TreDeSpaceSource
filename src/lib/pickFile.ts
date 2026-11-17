/** Open the browser's file picker from plain code (a hotkey, an action) and
 *  read the chosen file as text. Resolves null when the user cancels. The
 *  React panels use useFilePicker; this is for callers with no mounted UI. */
export function pickTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    const done = (v: { name: string; text: string } | null) => {
      input.remove();
      resolve(v);
    };
    input.addEventListener('cancel', () => done(null));
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        done(null);
        return;
      }
      file.text().then(
        (text) => done({ name: file.name, text }),
        () => done(null),
      );
    });
    input.click();
  });
}
