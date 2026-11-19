import type { Alert } from '../../shared/types';

/**
 * The two ways a P1 alert announces itself: a short tone generated in the
 * browser (no audio file), and a desktop notification.
 *
 * Browsers only allow sound after the page has been clicked or a key was
 * pressed once; unlockAudio() is called on the first such gesture. Desktop
 * notifications need the user's permission, asked when they are switched on.
 */

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (context) return context;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context = new Ctor();
  return context;
}

/** Call from a click or key handler so later alarms may play. */
export function unlockAudio(): void {
  const ctx = audioContext();
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
}

export function audioReady(): boolean {
  return context?.state === 'running';
}

/** Two falling tones, twice: distinct from ordinary system sounds, short. */
export function playAlarm(): boolean {
  const ctx = audioContext();
  if (!ctx) return false;
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  if (ctx.state !== 'running') return false;
  const start = ctx.currentTime + 0.02;
  const tones = [
    [988, 0],
    [740, 0.18],
    [988, 0.48],
    [740, 0.66],
  ] as const;
  for (const [frequency, offset] of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    const t = start + offset;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.17);
  }
  return true;
}

export type DesktopPermission = NotificationPermission | 'unsupported';

export function desktopPermission(): DesktopPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Must be called from a click handler. */
export async function requestDesktopPermission(): Promise<DesktopPermission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function describe(alert: Alert): string {
  const where = alert.customers.length > 0 ? alert.customers.join(', ') : (alert.service ?? alert.source);
  return `${alert.summary}${where ? `\n${where}` : ''}`;
}

/**
 * One notification per alert, up to three; more are summarised in one.
 * The tag makes browsers replace rather than stack a repeated notification.
 */
export function showDesktop(alerts: readonly Alert[], onOpen: (id: string) => void): number {
  if (desktopPermission() !== 'granted' || alerts.length === 0) return 0;
  const open = (id: string, n: Notification) => {
    window.focus();
    onOpen(id);
    n.close();
  };
  try {
    if (alerts.length > 3) {
      const n = new Notification(`${alerts.length} new P1 alerts`, {
        body: alerts.slice(0, 3).map((a) => `• ${a.summary}`).join('\n'),
        tag: 'jsm-alert-center-p1-summary',
        requireInteraction: true,
      });
      n.onclick = () => open(alerts[0]!.id, n);
      return 1;
    }
    for (const alert of alerts) {
      const n = new Notification(`P1${alert.tinyId ? ` #${alert.tinyId}` : ''}`, {
        body: describe(alert),
        tag: `jsm-alert-center-p1-${alert.id}`,
        requireInteraction: true,
      });
      n.onclick = () => open(alert.id, n);
    }
    return alerts.length;
  } catch {
    // Some browsers only allow notifications from a service worker.
    return 0;
  }
}
