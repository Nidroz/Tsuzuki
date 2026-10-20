// the score and notes of a library entry (BR-07, SPEC.md), with the BR-09 write convention of
// library-entry.ts: a change returns a new entry, a no-op the same reference
import {
  isValidNotes,
  isValidScore,
  updateLibraryEntry,
  type LibraryEntry,
  type LibraryWriteContext,
} from './library-entry';

/**
 * sets the score of an entry (BR-07), null to clear it, with the BR-09 convention. an invalid
 * score throws a RangeError, checked first (the UI validates with isValidScore: an invalid score
 * here is a programming error); stored scores are always valid, so an unchanged score is still a
 * no-op (the same reference), through updateLibraryEntry.
 */
export const setScore = (
  entry: LibraryEntry,
  score: number | null,
  ctx: LibraryWriteContext,
): LibraryEntry => {
  if (!isValidScore(score)) {
    // the message holds no value: the UI shows its own translated error
    throw new RangeError('score is outside the BR-07 range');
  }
  return updateLibraryEntry(entry, { score }, ctx);
};

/**
 * the notes the notes editor saves for its text: blank text (empty or white space only, as
 * String#trim sees it) is no notes (null); any other text is kept exactly as typed, untrimmed,
 * since line breaks and indentation can be intentional. no validation: see isValidNotes.
 */
export const notesFromInput = (text: string): string | null => (text.trim() === '' ? null : text);

/**
 * sets the notes of an entry (BR-07), null to clear them, with the BR-09 convention. invalid
 * notes throw a RangeError, checked first (the UI validates with isValidNotes); an unchanged value
 * is a no-op (the same reference), through updateLibraryEntry. the notes are stored as given:
 * callers turn the editor text into notes with notesFromInput first.
 */
export const setNotes = (
  entry: LibraryEntry,
  notes: string | null,
  ctx: LibraryWriteContext,
): LibraryEntry => {
  if (!isValidNotes(notes)) {
    // the message holds no value: notes are personal data
    throw new RangeError('notes are outside the BR-07 limits');
  }
  return updateLibraryEntry(entry, { notes }, ctx);
};
