import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appIconFile, appIconPath } from './app-icon';

const desktopDirectory = process.cwd();
const resources = join(desktopDirectory, 'resources');

const showOptions: Record<string, unknown>[] = [];

vi.mock('electron', () => {
  class StubBrowserWindow {
    public readonly webContents = {
      setWindowOpenHandler: () => undefined,
      on: () => undefined,
    };
    public constructor(options: Record<string, unknown>) {
      showOptions.push(options);
    }
    public once(): void {}
    public show(): void {}
    public maximize(): void {}
    public isMaximized(): boolean {
      return false;
    }
    public getNormalBounds(): {
      x: number;
      y: number;
      width: number;
      height: number;
    } {
      return { x: 0, y: 0, width: 1280, height: 840 };
    }
    public async loadFile(): Promise<void> {}
  }
  return {
    BrowserWindow: StubBrowserWindow,
    app: {
      isPackaged: false,
      getPath: () => join(tmpdir(), 'focusloop-icon-spec'),
      getAppPath: () => process.cwd(),
    },
    nativeTheme: { shouldUseDarkColors: false },
    screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1280, height: 800 } }] },
    shell: { openExternal: () => undefined },
  };
});

const temporaryDirectories: string[] = [];
afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

interface IcoEntry {
  readonly size: number;
  readonly planes: number;
  readonly bitsPerPixel: number;
  readonly bytes: number;
  readonly offset: number;
}

function readIco(buffer: Buffer): { readonly count: number; readonly entries: IcoEntry[] } {
  const count = buffer.readUInt16LE(4);
  const entries: IcoEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = 6 + index * 16;
    const width = buffer[at] ?? 0;
    entries.push({
      // A stored 0 means 256: the field is one byte.
      size: width === 0 ? 256 : width,
      planes: buffer.readUInt16LE(at + 4),
      bitsPerPixel: buffer.readUInt16LE(at + 6),
      bytes: buffer.readUInt32LE(at + 8),
      offset: buffer.readUInt32LE(at + 12),
    });
  }
  return { count, entries };
}

describe('the application icon', () => {
  it('selects the ICO on Windows and the PNG elsewhere', () => {
    expect(appIconFile('win32')).toBe('icon.ico');
    expect(appIconFile('darwin')).toBe('icon.png');
    expect(appIconFile('linux')).toBe('icon.png');
  });

  it('resolves from the project in development and from the packaged resources after packaging', () => {
    expect(
      appIconPath({
        isPackaged: false,
        resourcesPath: '/other',
        appPath: '/app',
        platform: 'win32',
      }),
    ).toBe(join('/app', 'resources', 'icon.ico'));
    expect(
      appIconPath({
        isPackaged: true,
        resourcesPath: '/app/resources',
        appPath: '/app.asar',
        platform: 'win32',
      }),
    ).toBe(join('/app/resources', 'icon.ico'));
    expect(
      appIconPath({
        isPackaged: true,
        resourcesPath: '/app/resources',
        appPath: '/app.asar',
        platform: 'darwin',
      }),
    ).toBe(join('/app/resources', 'icon.png'));
  });

  it('ships a multi-size ICO whose entries are real images', () => {
    const buffer = readFileSync(join(resources, 'icon.ico'));
    expect(buffer.readUInt16LE(0)).toBe(0);
    expect(buffer.readUInt16LE(2)).toBe(1);
    const { count, entries } = readIco(buffer);
    expect(count).toBe(7);
    expect(entries.map((entry) => entry.size)).toEqual([16, 24, 32, 48, 64, 128, 256]);
    for (const entry of entries) {
      expect(entry.planes).toBe(1);
      expect(entry.bitsPerPixel).toBe(32);
      expect(entry.offset + entry.bytes).toBeLessThanOrEqual(buffer.length);
      // Every entry is a PNG, which is the format Windows reads for 32-bit colour at any size.
      expect(buffer.subarray(entry.offset, entry.offset + 8).toString('hex')).toBe(
        '89504e470d0a1a0a',
      );
    }
  });

  it('ships a 512 PNG with an alpha channel', () => {
    const buffer = readFileSync(join(resources, 'icon.png'));
    expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(buffer.readUInt32BE(16)).toBe(512);
    expect(buffer.readUInt32BE(20)).toBe(512);
    expect(buffer[24]).toBe(8); // bit depth
    expect(buffer[25]).toBe(6); // colour type: RGBA
  });

  it('is referenced by packaging, so a config change cannot silently drop it', () => {
    const manifest = readFileSync(join(desktopDirectory, 'electron-builder.yml'), 'utf8');
    expect(manifest).toContain('buildResources: resources');
    const referenced = [...manifest.matchAll(/(?:^|\s)(?:win\.)?[a-zA-Z]*[iI]con:\s*(\S+)/g)].map(
      (match) => match[1]!,
    );
    expect(referenced).toContain('resources/icon.ico');
    for (const path of referenced) {
      expect(existsSync(join(desktopDirectory, path))).toBe(true);
    }
    // The window reads the packaged copy, so the files have to travel with the app.
    expect(manifest).toContain('from: resources/icon.ico');
    expect(manifest).toContain('from: resources/icon.png');
  });

  it('is mentioned by the release checklist', () => {
    const checklist = readFileSync(
      join(desktopDirectory, '..', '..', 'docs', 'publishing.md'),
      'utf8',
    );
    expect(checklist).toMatch(/icon/i);
  });

  it('is the icon the main window is created with', async () => {
    const { createMainWindow } = await import('./window');
    const directory = mkdtempSync(join(tmpdir(), 'focusloop-icon-'));
    temporaryDirectories.push(directory);
    await createMainWindow({
      isDev: false,
      rendererDirectory: directory,
      preloadPath: join(directory, 'preload.cjs'),
    });
    const options = showOptions.at(-1);
    const icon = options?.['icon'];
    expect(typeof icon).toBe('string');
    expect(icon).toBe(
      appIconPath({ isPackaged: false, resourcesPath: '', appPath: desktopDirectory }),
    );
    expect(existsSync(icon as string)).toBe(true);
  });
});
