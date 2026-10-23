import { Fragment } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { documentPathIn, type FiledDocument, type FolderRow, folderPaths } from '@/lib/folder-tree';
import { documentPath } from '@/lib/routes';
import type { SlotNode } from '@/lib/utils';

interface DuplicateLinksProps {
  /** The caller's other documents with the same contents, as `documentDuplicates` answers. */
  duplicates: readonly FiledDocument[];
  /** Every folder the caller has, so each copy is named by its path rather than its bare title. */
  folders: readonly FolderRow[];
}

/** Each other copy as a link to its page, named by its path in the archive. */
export function DuplicateLinks({ duplicates, folders }: DuplicateLinksProps) {
  const paths = folderPaths(folders);
  return duplicates.map((doc, index) => (
    <Fragment key={doc.id}>
      {index > 0 ? ', ' : null}
      <Link className="font-medium underline underline-offset-2" to={documentPath(doc.id)}>
        {documentPathIn(paths, doc)}
      </Link>
    </Fragment>
  ));
}

interface DuplicateAlertProps extends DuplicateLinksProps {
  /** What to do about it: on the document page, deleting this copy. */
  actionSlot?: SlotNode;
}

/**
 * Says the document holds the same bytes as others of the caller's. A warning and not an error:
 * the same file filed twice is sometimes meant, so nothing is refused and both are processed.
 */
export function DuplicateAlert({ duplicates, folders, actionSlot }: DuplicateAlertProps) {
  if (duplicates.length === 0) {
    return null;
  }
  return (
    <Alert
      variant="warning"
      title="You already have this file"
      // One <p>, so the links run inline: the description is a flex column, and a bare fragment
      // would put each link on a line of its own.
      description={
        <p>
          The same file is already in your archive as <DuplicateLinks duplicates={duplicates} folders={folders} />.
        </p>
      }
      actionSlot={actionSlot}
    />
  );
}
