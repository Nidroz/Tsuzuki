// types the i18next t function against the english catalog: an unknown key is a type error.
// fr.json must mirror en.json exactly (see README.md)
import 'i18next';

import type en from './en.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
    // a default value does not make an unknown key acceptable
    strictKeyChecks: true;
  }
}
