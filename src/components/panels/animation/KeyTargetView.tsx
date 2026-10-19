import { KeyAnnotations } from './KeyAnnotations';
import { KeyCallout } from './KeyCallout';
import { KeyCalloutsRow } from './KeyCalloutsRow';
import { KeyCamera } from './KeyCamera';
import { KeyNext } from './KeyNext';
import { KeyObjectInfo } from './KeyObjectInfo';
import { KeyObjectKey } from './KeyObjectKey';
import { KeyObjectsRow } from './KeyObjectsRow';
import { KeyRules } from './KeyRules';
import { KeyScene } from './KeyScene';
import { KeySection } from './KeySection';
import { KeyStep } from './KeyStep';
import { KeyStepsRow } from './KeyStepsRow';
import type { KeyTarget } from './useKeyTarget';

/** The panel's body for one target. */
export function KeyTargetView({ target: t }: { target: Exclude<KeyTarget, { kind: 'off' }> }) {
  switch (t.kind) {
    case 'objectKey':
      return (
        <>
          <KeyObjectKey object={t.object} index={t.index} indices={t.indices} />
          <KeyObjectInfo object={t.object} />
        </>
      );
    case 'object':
      return (
        <>
          <KeyNext object={t.object} />
          <KeyObjectInfo object={t.object} />
        </>
      );
    case 'camera':
      return <KeyCamera scene={t.scene} index={t.index} indices={t.indices} />;
    case 'section':
      return <KeySection scene={t.scene} index={t.index} indices={t.indices} />;
    case 'rules':
      return <KeyRules scene={t.scene} index={t.index} />;
    case 'annotations':
      return <KeyAnnotations kind={t.annotation} scene={t.scene} index={t.index} />;
    case 'step':
      return <KeyStep scene={t.scene} step={t.step} />;
    case 'steps':
      return <KeyStepsRow scene={t.scene} />;
    case 'callout':
      return <KeyCallout scene={t.scene} callout={t.callout} instance={t.instance} />;
    case 'callouts':
      return <KeyCalloutsRow scene={t.scene} />;
    case 'objects':
      return <KeyObjectsRow scene={t.scene} />;
    case 'scene':
      return <KeyScene scene={t.scene} />;
  }
}
