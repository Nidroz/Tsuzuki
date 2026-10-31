import { isIncomingLinkWithinLimits } from '@core/schemas/incoming-link';

// the route opened instead of an incoming link above the size limits
const HOME_PATH = '/';

/**
 * expo-router calls this for every link the system opens the app with, the initial one and the
 * ones received while the app runs, before it parses the link: a link above the size limits of
 * `isIncomingLinkWithinLimits` opens the home route instead (GHSA-qr28-fpjm-wq7f). any other link
 * passes through unchanged
 */
export const redirectSystemPath = ({ path }: { path: string; initial: boolean }): string =>
  isIncomingLinkWithinLimits(path) ? path : HOME_PATH;
