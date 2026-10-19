import { contextBridge, ipcRenderer } from 'electron';
import type { CustomerDisplaySnapshot } from '@odc-photostudio/contracts';
import type {
  CustomerDisplayBridge,
  CustomerDisplayFrame
} from '../renderer/customer-display/transport.js';

type SnapshotListener = (snapshot: CustomerDisplaySnapshot) => void;
type FrameListener = (frame: CustomerDisplayFrame) => void;

export const displayApi: CustomerDisplayBridge = {
  getSnapshot: () => ipcRenderer.invoke('odc:display:get-snapshot'),
  onSnapshot: (listener: SnapshotListener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, snapshot: CustomerDisplaySnapshot) =>
      listener(snapshot);
    ipcRenderer.on('odc:display:snapshot', wrapped);
    return () => ipcRenderer.removeListener('odc:display:snapshot', wrapped);
  },
  onFrame: (listener: FrameListener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, frame: CustomerDisplayFrame) => listener(frame);
    ipcRenderer.on('odc:display:frame', wrapped);
    return () => ipcRenderer.removeListener('odc:display:frame', wrapped);
  },
  ackSnapshot: (revision: number) => ipcRenderer.send('odc:display:ack-snapshot', { revision }),
  ackFrame: (sequence: number) => ipcRenderer.send('odc:display:ack-frame', { sequence })
};

contextBridge.exposeInMainWorld('odcDisplayBridge', displayApi);
