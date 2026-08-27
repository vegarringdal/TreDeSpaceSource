import { IconBook2, IconBrandGithub } from '@tabler/icons-react';
import { Button, Collapsible } from '@treDeSpaceUI/widgets';
import { openProductPage } from '../../../../lib/productUrl';
import { LicenseDialog } from './LicenseDialog';
import { ThirdPartyNotices } from './ThirdPartyNotices';

/** Settings → About tab: app info, docs link, licenses and notices. */
export function AboutTab() {
  return (
    <div className="flex flex-col gap-1.5">
      <Collapsible title="About">
        <div className="flex flex-col gap-1 text-slate-300 text-xs">
          <div className="font-medium text-slate-100 text-sm">TreDeSpace Web Viewer</div>
          <div>Made by Vegar Ringdal</div>
          <div className="text-slate-400">Version {__APP_VERSION__}</div>
          <p className="mt-1 text-slate-400 leading-relaxed">
            All processing happens in your browser — models never leave your machine.
          </p>
          <p className="text-slate-400 leading-relaxed">
            Provided as-is, without warranty of any kind — use at your own risk. Licensed under the TreDeSpace License
            (Elastic License 2.0 with attribution and public-improvement terms) — see “Show license” below for the full
            terms.
          </p>
        </div>
      </Collapsible>
      <Button
        icon={<IconBook2 size={14} />}
        onClick={() => openProductPage('docs/')}
        tooltip="Product page with the client API documentation and live demo — opens in a new tab (on tredespace.com unless this is a dev/localhost instance)"
        shortcut="settings.showDocs"
      >
        Show product / client API docs
      </Button>
      <Button
        icon={<IconBrandGithub size={14} />}
        onClick={() => void window.open('https://github.com/vegarringdal/TreDeSpaceSource', '_blank', 'noopener')}
        tooltip="TreDeSpace source repository on GitHub — opens in a new tab"
        shortcut="settings.showSource"
      >
        View source on GitHub
      </Button>
      <LicenseDialog />
      <ThirdPartyNotices />
    </div>
  );
}
