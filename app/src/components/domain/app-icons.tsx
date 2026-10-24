import {
  BookmarkPlus as BookmarkPlusSource,
  Bookmark as BookmarkSource,
  BookOpen as BookOpenSource,
  FileCode as FileCodeSource,
  FileImage as FileImageSource,
  FileSpreadsheet as FileSpreadsheetSource,
  FolderInput as FolderInputSource,
  FolderPlus as FolderPlusSource,
  Unplug as UnplugSource,
} from 'lucide-react';
import { icon } from '@/components/ui/icons';

// Glyphs this app needs that `@cubeui/icons` does not carry, wrapped the way it
// says to add one, so they size and colour like the rest.

/** A new folder. */
export const FolderPlus = icon(FolderPlusSource);
/** Move into a folder. */
export const FolderInput = icon(FolderInputSource);
/** Stop sharing with MCP clients. */
export const Unplug = icon(UnplugSource);
/** A saved search. */
export const Bookmark = icon(BookmarkSource);
/** Save this search. */
export const BookmarkPlus = icon(BookmarkPlusSource);
/** An image with no thumbnail yet. */
export const FileImage = icon(FileImageSource);
/** A CSV. */
export const FileSpreadsheet = icon(FileSpreadsheetSource);
/** Markdown or a saved web page: text with markup. */
export const FileCode = icon(FileCodeSource);
/** An ebook. */
export const BookOpen = icon(BookOpenSource);
