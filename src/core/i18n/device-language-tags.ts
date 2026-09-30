import { z } from 'zod';

// a bcp 47 language tag, loosely: a 2 or 3 letter primary language subtag, then subtags of 1 to 8
// letters or digits separated by "-" (or "_", as some platforms report posix-style locales)
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{1,8})*$/;

const languageTagSchema = z.string().trim().regex(LANGUAGE_TAG);

/**
 * the device language tags reported by the platform, most preferred first. the input is untrusted
 * (CONTRIBUTING.md section 5): a non-array yields no tags and invalid entries are dropped, so a
 * malformed report never breaks language resolution
 */
export const deviceLanguageTagsSchema = z
  .array(z.unknown())
  .catch([])
  .transform((entries): readonly string[] =>
    entries.flatMap((entry) => {
      const tag = languageTagSchema.safeParse(entry);
      return tag.success ? [tag.data] : [];
    }),
  );

export const parseDeviceLanguageTags = (input: unknown): readonly string[] =>
  deviceLanguageTagsSchema.parse(input);
