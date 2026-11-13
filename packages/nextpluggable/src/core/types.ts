import type { PluginBuild, PluginManifest } from '@nextpluggable/plugin/manifest';

export interface SourceRecord {
  id: string;
  type: 'github' | 'local';
  /** Human name, e.g. `acme/site-plugins`. */
  label: string;
  addedAt: string;
  github?: {
    owner: string;
    repo: string;
    /** Branch or tag to follow. Default: the repository's default branch. */
    ref?: string;
    /** Sub-directory that holds the plugins. */
    dir?: string;
    /** Access token, encrypted with the site secret. */
    token?: string;
  };
  local?: { dir: string };
}

export interface CatalogEntry {
  /** Plugin directory inside the source. */
  path: string;
  build: PluginBuild;
  /** Fingerprint of dist/build.json — changes whenever the plugin is rebuilt. */
  buildHash: string;
}

export interface Catalog {
  sourceId: string;
  /** Commit the listing was read at. */
  revision: string;
  fetchedAt: string;
  name?: string;
  description?: string;
  plugins: CatalogEntry[];
  problems: { path: string; message: string }[];
}

export type FileKind = 'client' | 'server' | 'style';

export interface StoredFile {
  sha256: string;
  bytes: number;
}

export interface InstallRecord {
  id: string;
  manifest: PluginManifest;
  icon?: string;
  buildHash: string;
  source: { id: string; label: string; path: string; revision: string };
  files: Partial<Record<FileKind, StoredFile>>;
  /** Files of the previously installed version, kept so pages cached before an update keep working. */
  previousFiles?: Partial<Record<FileKind, StoredFile>>;
  enabled: boolean;
  /** Setting values; secrets are encrypted. */
  config: Record<string, string | number | boolean>;
  /** Page addresses chosen by the site owner, keyed by page id. */
  paths: Record<string, string>;
  installedAt: string;
  updatedAt: string;
}

export type Installs = Record<string, InstallRecord>;
