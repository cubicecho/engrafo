import { useMutation } from '@apollo/client/react';
import { useState } from 'react';
import { graphql } from '@/__generated__';
import { FolderPlus } from '@/components/domain/app-icons';
import { NameDialog } from '@/components/domain/name-dialog';
import { Button } from '@/components/ui/button';
import { ARCHIVE_QUERY_NAME } from '@/lib/archive';
import { folderNameError } from '@/lib/folder-tree';

const CreateTopLevelFolder = graphql(`
  mutation CreateTopLevelFolder($name: String!) {
    createFolder(name: $name) {
      id
    }
  }
`);

interface NewFolderButtonProps {
  /** `icon`: a glyph alone, for the sidebar's section header. `label`: the glyph and the words. */
  look?: 'icon' | 'label' | undefined;
}

/**
 * Makes a folder at the top level. A folder inside another is made from that folder's menu in the
 * tree, which knows where it is; this is the one place that does not.
 */
export function NewFolderButton({ look = 'label' }: NewFolderButtonProps) {
  const [open, setOpen] = useState(false);
  const [createFolder] = useMutation(CreateTopLevelFolder, {
    refetchQueries: [ARCHIVE_QUERY_NAME],
    awaitRefetchQueries: true,
  });

  return (
    <>
      {look === 'icon' ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="New folder"
          hint="New folder"
          iconSlot={<FolderPlus />}
          onClick={() => setOpen(true)}
        />
      ) : (
        <Button
          size="sm"
          variant="outline"
          iconSlot={<FolderPlus />}
          content="New folder"
          onClick={() => setOpen(true)}
        />
      )}
      {open && (
        <NameDialog
          title="New folder"
          label="Name"
          submitLabel="Create"
          validate={folderNameError}
          onSave={(name) => createFolder({ variables: { name } })}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
