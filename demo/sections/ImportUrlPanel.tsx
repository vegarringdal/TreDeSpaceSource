import { Button, NumberInput, Select, TextArea } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import type { ImportFormat, ImportUrlProgress } from '../../api/tredespace-client';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';
import { IMPORT_FORMAT_OPTIONS, must, splitLines, toImportFormat } from '../util';

type ImportUrlPanelProps = Readonly<{
  store?: string;
  replace: boolean;
}>;

/** Batch import by URL. The VIEWER downloads each URL itself — no bytes cross
 *  postMessage. The wire needs an explicit format per file (a .glb URL is
 *  ambiguous), so the format select applies to every line. `concurrent` files
 *  are processed at once end-to-end (glb/tdp download AND cook in parallel;
 *  the rvm/ifc/step converters still run one after another). Passing
 *  onProgress also silences the viewer's own import dialogs. */
export function ImportUrlPanel({ store, replace }: ImportUrlPanelProps) {
  const { run, c, line } = useDemo();
  const [urls, setUrls] = useState('');
  const [format, setFormat] = useState<ImportFormat>('glb-standard');
  const [concurrent, setConcurrent] = useState(3);

  const buildFiles = (): { url: string; format: ImportFormat }[] | null => {
    const list = splitLines(urls);
    if (!list.length) {
      line('err', 'paste at least one URL');
      return null;
    }

    return list.map((url) => ({ url, format }));
  };

  const urlOpts = () => ({
    concurrent,
    store,
    replace,
    onProgress: (p: ImportUrlProgress) => {
      // files run in parallel — the index says which one a tick belongs to
      const pct = p.totalBytes ? ` ${Math.round(((p.loaded ?? 0) / p.totalBytes) * 100)}%` : '';
      line('', `  … [${p.completed}/${p.total}] #${p.index} ${p.phase}${pct} ${p.url}`);
    },
  });

  const handleFormatChange = (v: string | null) => {
    const f = toImportFormat(v);
    if (f) {
      setFormat(f);
    }
  };

  const handleSend = () => {
    const files = buildFiles();
    if (!files) {
      return;
    }

    void run('assets.importUrl', { files, concurrent, store, replace }, () => c().assetsImportUrl(files, urlOpts()));
  };

  // batch import then load everything that converted
  const handleSendLoad = () => {
    const files = buildFiles();
    if (!files) {
      return;
    }

    void run('assets.importUrl + load', { files, concurrent, store }, async () => {
      const imp = must(await c().assetsImportUrl(files, urlOpts()));
      const ids = imp.results.flatMap((r) => r.entries?.map((e) => e.id) ?? []);
      if (ids.length) {
        must(await c().assetsLoad(ids, { fit: true, store }));
      }

      return { data: { imported: imp.imported, failed: imp.failed, loaded: ids.length } };
    });
  };

  return (
    <>
      <Hint>
        Batch-import by URL — the <b>viewer</b> downloads each file (nothing over postMessage). One URL per line; the
        format applies to every line. Downloads run <code>concurrent</code> at a time; cooking stays serial.
      </Hint>
      <TextArea value={urls} onChange={setUrls} rows={3} placeholder={'https://…/model.rvm\nhttps://…/other.rvm'} />
      <Row>
        <Select value={format} onChange={handleFormatChange} options={IMPORT_FORMAT_OPTIONS} className="min-w-32" />
        <NumberInput value={concurrent} onChange={setConcurrent} min={1} max={8} step={1} className="w-24" />
        <Button onClick={handleSend}>assets.importUrl</Button>
        <Button onClick={handleSendLoad}>importUrl + load</Button>
      </Row>
    </>
  );
}
