import {
  FolderInput as FolderInputSource,
  FolderPlus as FolderPlusSource,
  LogOut as LogOutSource,
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
/** Sign out. */
export const LogOut = icon(LogOutSource);
