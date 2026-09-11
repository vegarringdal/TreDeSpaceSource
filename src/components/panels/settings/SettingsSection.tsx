import { IconRestore } from '@tabler/icons-react';
import { Button, Collapsible } from '@treDeSpaceUI/widgets';
import type { ReactNode } from 'react';
import { resetSection, SETTINGS_SECTIONS, type SettingsSectionId, useSectionDirty } from './sectionResets';

/** A Settings collapsible with the section's own reset in the header — greyed
 *  out while the section already equals its defaults — and a mandatory info
 *  popover, so every section explains itself. */
export function SettingsSection({
  id,
  title,
  info,
  defaultOpen,
  children,
}: {
  id: SettingsSectionId;
  title: string;
  info: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const isDirty = useSectionDirty(id);
  const label = SETTINGS_SECTIONS[id].label;

  return (
    <Collapsible
      title={title}
      info={info}
      defaultOpen={defaultOpen}
      actions={
        <Button
          iconOnly
          className="h-4 w-4"
          icon={<IconRestore size={14} />}
          disabled={!isDirty}
          tooltip={isDirty ? `Reset ${label} to defaults` : `${label} is at its defaults`}
          shortcut={`settings.reset.${id}`}
          onClick={() => resetSection(id)}
        />
      }
    >
      {children}
    </Collapsible>
  );
}
