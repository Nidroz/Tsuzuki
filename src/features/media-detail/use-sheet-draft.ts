import { useState, type Dispatch, type SetStateAction } from 'react';

/**
 * the draft a library sheet edits: a copy of `initial` taken each time the sheet opens, so closing
 * without saving discards it, as in the search filters sheet. while the sheet is open, a new
 * `initial` (a refetched entry) leaves the draft alone
 */
export const useSheetDraft = <T>(
  visible: boolean,
  initial: T,
): readonly [T, Dispatch<SetStateAction<T>>] => {
  const [draft, setDraft] = useState(initial);
  const [wasVisible, setWasVisible] = useState(visible);

  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setDraft(initial);
    }
  }

  return [draft, setDraft];
};
