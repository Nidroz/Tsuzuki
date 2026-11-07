import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export interface AnnouncementOptions {
  /**
   * views showing the same state pass the same key, so it is announced once: e.g. a failed guest
   * merge shown by the library tab, the favorites tab and the detail screen at the same time
   */
  key?: string;
}

// the holders of a key mounted right now, each with the message it shows, and the message last
// announced for the key
interface KeyedAnnouncement {
  readonly holders: Map<symbol, string | null>;
  lastAnnounced: string | null;
}

// one entry per key with at least one mounted holder: the last holder to unmount deletes it, so
// the registry never outgrows the views on screen
const registry = new Map<string, KeyedAnnouncement>();

/** number of keys with a mounted holder, for the tests of the registry's cleanup */
export const heldAnnouncementKeyCount = (): number => registry.size;

const announce = (message: string) => {
  AccessibilityInfo.announceForAccessibility(message);
};

// a holder that starts showing a message (on mount, or after null) joins a state another view
// may show already, maybe worded differently (an ErrorState's title and message, an InlineError's
// message): it announces only when no other holder of the key shows one. a holder whose message
// changes from one to another reports a change of the state: it announces unless another holder
// announced the same message already, so views changing together announce it once
const hold = (key: string, holder: symbol, message: string | null, wasShowing: boolean) => {
  const entry = registry.get(key) ?? { holders: new Map(), lastAnnounced: null };
  registry.set(key, entry);
  const othersShowing = [...entry.holders.values()].some((shown) => shown !== null);
  entry.holders.set(holder, message);
  if (message === null) {
    return;
  }
  const news = wasShowing ? message !== entry.lastAnnounced : !othersShowing;
  if (news) {
    entry.lastAnnounced = message;
    announce(message);
  }
};

const release = (key: string, holder: symbol) => {
  const entry = registry.get(key);
  if (entry === undefined) {
    return;
  }
  entry.holders.delete(holder);
  if (entry.holders.size === 0) {
    // forgotten: a later mount announces again
    registry.delete(key);
  }
};

/**
 * announces a translated message to screen readers on mount and whenever it changes; `null`
 * announces nothing. with a key, views showing the same state announce it once (see
 * AnnouncementOptions). features announce through this hook, never through AccessibilityInfo
 */
export function useAnnouncement(message: string | null, options: AnnouncementOptions = {}): void {
  const { key } = options;
  // a stable identity of this holder among the holders of its key
  const [holder] = useState(() => Symbol('announcement holder'));
  // the key this holder showed a message under at its last hold, null when it showed none: the
  // cleanup releases the holder before its next hold, so the registry cannot tell
  const shownUnderRef = useRef<string | null>(null);

  // the cleanup releases the previous message before the next one is held: react runs every
  // cleanup of a commit before its effects, so holders changing together see each other's new
  // message only, and the first of them announces it
  useEffect(() => {
    if (key === undefined) {
      shownUnderRef.current = null;
      if (message !== null) {
        announce(message);
      }
      return undefined;
    }
    hold(key, holder, message, shownUnderRef.current === key);
    shownUnderRef.current = message === null ? null : key;
    return () => {
      release(key, holder);
    };
  }, [key, message, holder]);
}
