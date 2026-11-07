import { useEffect, useState } from 'react';
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

const hold = (key: string, holder: symbol, message: string | null) => {
  const entry = registry.get(key) ?? { holders: new Map(), lastAnnounced: null };
  registry.set(key, entry);
  entry.holders.set(holder, message);
  // a holder joining or changing with the message already announced for the key stays silent:
  // two views showing the same state, or changing together, announce it once
  if (message !== null && message !== entry.lastAnnounced) {
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
    return;
  }
  // the state ended in every remaining view: showing the same message again is news
  if ([...entry.holders.values()].every((message) => message === null)) {
    entry.lastAnnounced = null;
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

  // the cleanup releases the previous message before the next one is held: react runs every
  // cleanup of a commit before its effects, so holders changing together see each other's new
  // message only, and the first of them announces it
  useEffect(() => {
    if (key === undefined) {
      if (message !== null) {
        announce(message);
      }
      return undefined;
    }
    hold(key, holder, message);
    return () => {
      release(key, holder);
    };
  }, [key, message, holder]);
}
