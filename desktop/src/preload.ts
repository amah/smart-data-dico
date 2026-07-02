/**
 * Minimal contextBridge. The SPA talks to the local server over HTTP exactly as
 * it does in a browser; this only exposes the few desktop-native affordances.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('dicoDesktop', {
  /** App version (from package.json). */
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  /** Open the native folder picker and switch the active project. */
  openFolder: (): Promise<void> => ipcRenderer.invoke('app:openFolder'),
});
