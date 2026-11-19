import { useEffect, useRef } from 'react';
import type { Alert } from '../../shared/types';
import { playAlarm, showDesktop, unlockAudio } from '../lib/alarm';
import { arrivingP1, claimAlarms, releaseAlarms } from '../lib/p1Watch';

/**
 * Sounds and/or shows a desktop notification when a P1 alert arrives (see
 * src/lib/p1Watch.ts). Works on every loaded alert, whatever the filters
 * or customer scope, so an alarm is never hidden by a view.
 */
export function useP1Alarm(alerts: readonly Alert[] | undefined, sound: boolean, desktop: boolean, onOpen: (id: string) => void): void {
  const enabled = sound || desktop;
  const previous = useRef<Set<string> | null>(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  // Browsers allow sound only after a click or key press on the page.
  useEffect(() => {
    if (!sound) return;
    const unlock = () => unlockAudio();
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    return () => {
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
    };
  }, [sound]);

  useEffect(() => {
    // Switched off: forget the baseline, so switching on again does not
    // announce everything that arrived in between.
    if (!enabled) previous.current = null;
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !alerts) return;
    const { watched, arrived } = arrivingP1(previous.current, alerts);
    if (previous.current) {
      const left = [...previous.current].filter((id) => !watched.has(id));
      if (left.length > 0) releaseAlarms(left);
    }
    previous.current = watched;
    const mine = claimAlarms(arrived);
    if (mine.length === 0) return;
    if (sound) playAlarm();
    if (desktop) showDesktop(mine, (id) => openRef.current(id));
  }, [alerts, enabled, sound, desktop]);
}
