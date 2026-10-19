import { IconDownload, IconUpload } from '@tabler/icons-react';
import { Button, Menu } from '@treDeSpaceUI/widgets';
import { overlayFileActions } from '../../../state/overlayComponents/overlayFile.actions';
import { useMenuAnchor } from '../shared/useMenuAnchor';

/** Export ▾ (the open design, or all of yours with your themes) and Import…
 *  for the library — *.tdoverlay.json files, also what a plan file carries. */
export function OverlayLibraryFiles() {
  const menu = useMenuAnchor('overlay.menu.export');

  return (
    <>
      <span ref={menu.wrap} className="inline-flex">
        <Button
          size="sm"
          icon={<IconDownload />}
          tooltip="Save designs to a file — the open one, or all of yours with your themes"
          shortcut="overlay.menu.export"
          onClick={menu.open}
        >
          Export ▾
        </Button>
      </span>
      <Button
        size="sm"
        icon={<IconUpload />}
        tooltip="Add the designs and themes in a file to your library"
        shortcut="overlay.import"
        onClick={() => void overlayFileActions.importFile()}
      >
        Import…
      </Button>
      <Menu
        anchor={menu.anchor}
        onClose={menu.close}
        items={[
          {
            id: 'open',
            label: 'This design',
            tooltip: 'The design open in the editor, as it is now',
            shortcut: 'overlay.export',
            onSelect: overlayFileActions.exportOpen,
          },
          {
            id: 'all',
            label: 'All my designs and themes',
            tooltip: 'Every design and theme of your own (not the built-in ones), in one file',
            shortcut: 'overlay.exportAll',
            onSelect: overlayFileActions.exportAll,
          },
        ]}
      />
    </>
  );
}
