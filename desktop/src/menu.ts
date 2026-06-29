/**
 * Native application menu. Keeps the standard edit/view/window roles and adds
 * the desktop-specific bits: "Open Folder…" (project switch) and a Help link to
 * the GitHub repo.
 */
import { Menu, shell, app, type MenuItemConstructorOptions } from 'electron';

export interface MenuCallbacks {
  onOpenFolder: () => void;
  repoUrl: string;
}

export function buildMenu({ onOpenFolder, repoUrl }: MenuCallbacks): Menu {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{ role: 'appMenu' as const }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: () => onOpenFolder(),
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Smart Data Dictionary on GitHub',
          click: () => void shell.openExternal(repoUrl),
        },
        {
          label: `Version ${app.getVersion()}`,
          enabled: false,
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
