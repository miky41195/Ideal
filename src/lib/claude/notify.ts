import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window';

/** Windows toast plus a taskbar flash; either failing must never disturb the session. */
export async function callBack(title: string, body: string): Promise<void> {
  void getCurrentWindow()
    .requestUserAttention(UserAttentionType.Informational)
    .catch((e) => console.warn('taskbar flash failed', e));
  try {
    const ok = (await isPermissionGranted()) || (await requestPermission()) === 'granted';
    if (ok) sendNotification({ title, body });
  } catch (e) {
    console.warn('notification failed', e);
  }
}
