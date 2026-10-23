import { NameDialog } from '@/components/domain/name-dialog';

interface RenameDocumentDialogProps {
  /** The title as it stands, which the field opens on. */
  title: string;
  /** Saves the trimmed title. The dialog closes once this resolves, and says why when it rejects. */
  onRename: (title: string) => Promise<unknown>;
  /** Called when the dialog should go away: saved, cancelled or dismissed. */
  onClose: () => void;
}

/** What is wrong with a title as typed. The server checks the same, and that nothing beside it has it. */
export function titleError(title: string): string | undefined {
  if (title.trim() === '') {
    return 'Give the document a title';
  }
  // The title is the document's name in its folder; a `/` would draw as a folder.
  if (title.includes('/')) {
    return 'A title cannot contain "/"';
  }
  return undefined;
}

/**
 * Renaming a document is a form in a dialog, with a Save and a Cancel, rather than the title
 * turning into an input in place. The title is also its name in its folder, so the server refuses
 * one something beside it already has, and the dialog says so.
 */
export function RenameDocumentDialog({ title, onRename, onClose }: RenameDocumentDialogProps) {
  return (
    <NameDialog
      title="Rename document"
      description="The file it was uploaded as keeps its own name."
      label="Title"
      initial={title}
      validate={titleError}
      onSave={onRename}
      onClose={onClose}
    />
  );
}
