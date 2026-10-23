import { documents, folders } from '@cubicecho/engrafo-db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode } from '../../core/errors.ts';
import {
  createClient,
  createFakeStorage,
  createTestDb,
  createUser,
  type FakeStorage,
  type TestDb,
} from '../helpers.ts';

const CREATE_FOLDER = `
  mutation ($name: String!, $parentId: UUID) { createFolder(name: $name, parentId: $parentId) { id name parentId } }
`;
const RENAME_FOLDER = 'mutation ($id: UUID!, $name: String!) { renameFolder(id: $id, name: $name) { id name } }';
const MOVE_FOLDER =
  'mutation ($id: UUID!, $parentId: UUID) { moveFolder(id: $id, parentId: $parentId) { id parentId } }';
const DELETE_FOLDER = 'mutation ($id: UUID!) { deleteFolder(id: $id) }';
const UPLOAD = `
  mutation ($input: CreateDocumentUploadInput!) {
    createDocumentUpload(input: $input) { document { id title folderId originalKey } }
  }
`;
const MOVE_DOCUMENT = `
  mutation ($id: UUID!, $folderId: UUID) { moveDocument(id: $id, folderId: $folderId) { id folderId } }
`;
const RENAME_DOCUMENT =
  'mutation ($id: UUID!, $title: String!) { renameDocument(id: $id, title: $title) { id title } }';

describe('folders', () => {
  let db: TestDb;
  let userId: string;
  let otherId: string;
  let storage: FakeStorage;

  beforeEach(async () => {
    db = await createTestDb();
    userId = await createUser(db, 'owner@example.com');
    otherId = await createUser(db, 'other@example.com');
    storage = createFakeStorage();
  });

  const client = () => createClient(db, userId, { storage });
  const other = () => createClient(db, otherId, { storage });

  async function folder(name: string, parentId: string | null = null): Promise<string> {
    const data = await client().expectOk(CREATE_FOLDER, { name, parentId });
    return data.createFolder.id;
  }

  async function upload(filename: string, folderId: string | null = null) {
    const data = await client().expectOk(UPLOAD, {
      input: { filename, mimeType: 'application/pdf', sizeBytes: 5, folderId },
    });
    return data.createDocumentUpload.document;
  }

  describe('creating', () => {
    it('makes folders at the top level and inside one another, and lists only the caller’s', async () => {
      const taxes = await folder('Taxes');
      const year = await folder('2026', taxes);
      await other().expectOk(CREATE_FOLDER, { name: 'Private' });

      const data = await client().expectOk(
        '{ folders(orderBy: { name: { direction: asc, priority: 1 } }) { id name parentId } }',
      );
      expect(data.folders).toEqual([
        { id: year, name: '2026', parentId: taxes },
        { id: taxes, name: 'Taxes', parentId: null },
      ]);
    });

    it.each([
      ['empty', '   '],
      ['a slash', 'a/b'],
      ['a leading dot', '.hidden'],
      ['too long', 'x'.repeat(65)],
    ])('refuses a name that is %s', async (_name, name) => {
      const error = await client().expectError(CREATE_FOLDER, { name });
      expect(error.code).toBe(ErrorCode.BadUserInput);
    });

    it('refuses a name already beside it, in any case, whether a folder or a document has it', async () => {
      await folder('Taxes');
      expect((await client().expectError(CREATE_FOLDER, { name: 'taxes' })).code).toBe(ErrorCode.Conflict);

      await upload('Receipts.pdf');
      expect((await client().expectError(CREATE_FOLDER, { name: 'Receipts' })).code).toBe(ErrorCode.Conflict);
    });

    it('allows the same name in different folders', async () => {
      const a = await folder('A');
      const b = await folder('B');
      await folder('Notes', a);
      await folder('Notes', b);
    });

    it('answers NOT_FOUND for a parent that is someone else’s', async () => {
      const theirs = (await other().expectOk(CREATE_FOLDER, { name: 'Theirs' })).createFolder.id;
      expect((await client().expectError(CREATE_FOLDER, { name: 'Mine', parentId: theirs })).code).toBe(
        ErrorCode.NotFound,
      );
    });
  });

  describe('renaming', () => {
    it('renames, including a change of case alone', async () => {
      const id = await folder('taxes');
      expect((await client().expectOk(RENAME_FOLDER, { id, name: 'Taxes' })).renameFolder.name).toBe('Taxes');
    });

    it('refuses a name something beside it has', async () => {
      await folder('Taxes');
      const id = await folder('Bills');
      expect((await client().expectError(RENAME_FOLDER, { id, name: 'TAXES' })).code).toBe(ErrorCode.Conflict);
    });

    it('answers NOT_FOUND for someone else’s folder', async () => {
      const theirs = (await other().expectOk(CREATE_FOLDER, { name: 'Theirs' })).createFolder.id;
      expect((await client().expectError(RENAME_FOLDER, { id: theirs, name: 'Mine' })).code).toBe(ErrorCode.NotFound);
    });
  });

  describe('moving', () => {
    it('moves a folder into another and back to the top level', async () => {
      const a = await folder('A');
      const b = await folder('B');
      expect((await client().expectOk(MOVE_FOLDER, { id: b, parentId: a })).moveFolder.parentId).toBe(a);
      expect((await client().expectOk(MOVE_FOLDER, { id: b, parentId: null })).moveFolder.parentId).toBeNull();
    });

    it('refuses a move into itself or into a folder under it', async () => {
      const a = await folder('A');
      const b = await folder('B', a);
      const c = await folder('C', b);
      for (const parentId of [a, c]) {
        expect((await client().expectError(MOVE_FOLDER, { id: a, parentId })).code).toBe(ErrorCode.BadUserInput);
      }
    });

    it('refuses a move onto a name already there', async () => {
      const a = await folder('A');
      await folder('Notes', a);
      const notes = await folder('Notes');
      expect((await client().expectError(MOVE_FOLDER, { id: notes, parentId: a })).code).toBe(ErrorCode.Conflict);
    });
  });

  describe('deleting', () => {
    it('deletes the folder, the folders under it and every document in them, with their files', async () => {
      const a = await folder('A');
      const b = await folder('B', a);
      const inA = await upload('one.pdf', a);
      const inB = await upload('two.pdf', b);
      const outside = await upload('three.pdf');
      for (const doc of [inA, inB, outside]) {
        storage.files.objects.set(doc.originalKey, { body: Buffer.from('%PDF-'), contentType: 'application/pdf' });
      }
      const textKey = `text/${userId}/${inB.id}`;
      storage.text.objects.set(textKey, { body: Buffer.from('words'), contentType: 'text/plain' });
      await db.update(documents).set({ contentKey: textKey }).where(eq(documents.id, inB.id));

      expect((await client().expectOk(DELETE_FOLDER, { id: a })).deleteFolder).toBe(true);

      expect(await db.select({ id: folders.id }).from(folders)).toEqual([]);
      expect(await db.select({ id: documents.id }).from(documents)).toEqual([{ id: outside.id }]);
      expect([...storage.files.objects.keys()]).toEqual([outside.originalKey]);
      expect(storage.text.objects.size).toBe(0);
    });

    it('answers NOT_FOUND for someone else’s folder, and leaves it be', async () => {
      const theirs = (await other().expectOk(CREATE_FOLDER, { name: 'Theirs' })).createFolder.id;
      expect((await client().expectError(DELETE_FOLDER, { id: theirs })).code).toBe(ErrorCode.NotFound);
      expect(await db.select({ id: folders.id }).from(folders)).toEqual([{ id: theirs }]);
    });
  });

  describe('documents in folders', () => {
    it('uploads into a folder, numbering a title that is already there', async () => {
      const a = await folder('A');
      const first = await upload('scan.pdf', a);
      const second = await upload('scan.pdf', a);
      const elsewhere = await upload('scan.pdf');
      expect([first, second, elsewhere].map((doc) => [doc.title, doc.folderId])).toEqual([
        ['scan', a],
        ['scan (2)', a],
        ['scan', null],
      ]);
    });

    it('numbers past a title a folder beside it already has', async () => {
      await folder('scan');
      expect((await upload('scan.pdf')).title).toBe('scan (2)');
    });

    it('answers NOT_FOUND for an upload into someone else’s folder', async () => {
      const theirs = (await other().expectOk(CREATE_FOLDER, { name: 'Theirs' })).createFolder.id;
      const error = await client().expectError(UPLOAD, {
        input: { filename: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 5, folderId: theirs },
      });
      expect(error.code).toBe(ErrorCode.NotFound);
    });

    it('moves a document between folders and back to the top level', async () => {
      const a = await folder('A');
      const doc = await upload('scan.pdf');
      expect((await client().expectOk(MOVE_DOCUMENT, { id: doc.id, folderId: a })).moveDocument.folderId).toBe(a);
      expect((await client().expectOk(MOVE_DOCUMENT, { id: doc.id, folderId: null })).moveDocument.folderId).toBeNull();
    });

    it('refuses to move a document onto a name already there, and never overwrites', async () => {
      const a = await folder('A');
      await upload('scan.pdf', a);
      const doc = await upload('SCAN.pdf');
      expect((await client().expectError(MOVE_DOCUMENT, { id: doc.id, folderId: a })).code).toBe(ErrorCode.Conflict);
    });

    it('refuses a rename onto a name already beside it, but not a change of case', async () => {
      await upload('invoice.pdf');
      const doc = await upload('receipt.pdf');
      expect((await client().expectError(RENAME_DOCUMENT, { id: doc.id, title: 'Invoice' })).code).toBe(
        ErrorCode.Conflict,
      );
      expect((await client().expectOk(RENAME_DOCUMENT, { id: doc.id, title: 'Receipt' })).renameDocument.title).toBe(
        'Receipt',
      );
    });

    it('refuses a title with a slash in it', async () => {
      const doc = await upload('receipt.pdf');
      expect((await client().expectError(RENAME_DOCUMENT, { id: doc.id, title: 'a/b' })).code).toBe(
        ErrorCode.BadUserInput,
      );
    });

    it('lists a folder’s documents through the generated relation', async () => {
      const a = await folder('A');
      const doc = await upload('scan.pdf', a);
      const data = await client().expectOk(
        'query ($id: UUID!) { folder(where: { id: { eq: $id } }) { documents { id } } }',
        {
          id: a,
        },
      );
      expect(data.folder.documents).toEqual([{ id: doc.id }]);
    });
  });
});
