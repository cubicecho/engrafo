import { Link } from 'react-router';
import type { DocumentStatusEnum } from '@/__generated__/graphql';
import { DocumentStatusBadge } from '@/components/domain/status-badge';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes, formatDate } from '@/lib/format';

/** One document, as the list query selects it. */
export interface DocumentRow {
  id: string;
  title: string;
  /** The name the file was uploaded under, shown beneath the title. */
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatusEnum;
  createdAt: string;
}

interface DocumentsTableProps {
  /** The rows, in the order to draw them. The caller keeps an empty archive away from here. */
  documents: readonly DocumentRow[];
}

/** The archive as a table: a row per document, each title a link to its page. */
export function DocumentsTable({ documents }: DocumentsTableProps) {
  return (
    <Table>
      <TableCaption className="sr-only">Your documents, newest first</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="text-right">Size</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Added</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents.map((doc) => (
          <TableRow key={doc.id}>
            <TableHead className="max-w-[24rem]">
              <Link className="font-medium text-info hover:underline" to={`/documents/${doc.id}`}>
                {doc.title}
              </Link>
              <div className="truncate font-normal text-foreground/60 text-xs">{doc.originalFilename}</div>
            </TableHead>
            <TableCell className="text-foreground/60">{doc.mimeType}</TableCell>
            <TableCell className="text-right tabular-nums">{formatBytes(doc.sizeBytes)}</TableCell>
            <TableCell>
              <DocumentStatusBadge status={doc.status} />
            </TableCell>
            <TableCell className="text-foreground/60">{formatDate(doc.createdAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
