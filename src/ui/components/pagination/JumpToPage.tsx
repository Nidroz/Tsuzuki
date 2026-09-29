import { useCallback, useState } from 'react';

import { Box } from '../Box';
import { Button } from '../Button';
import { Input } from '../Input';
import { Row } from '../Row';
import { parsePageInput } from './page-window';

export interface JumpToPageProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** translated field label, e.g. "Go to page" */
  label: string;
  /** translated submit button label, e.g. "Go" */
  submitLabel: string;
  inputTestID?: string;
  submitTestID?: string;
}

/**
 * a numeric field and a submit button. an out-of-range page is clamped to 1..pageCount, text that
 * is not a whole number is ignored, and onPageChange is called only when the page changes
 */
export function JumpToPage({
  page,
  pageCount,
  onPageChange,
  label,
  submitLabel,
  inputTestID,
  submitTestID,
}: JumpToPageProps) {
  const [text, setText] = useState('');

  const submit = useCallback(() => {
    const target = parsePageInput(text, pageCount);
    if (target === null) {
      return;
    }
    setText('');
    if (target !== page) {
      onPageChange(target);
    }
  }, [text, pageCount, page, onPageChange]);

  return (
    <Row gap="sm" align="end">
      <Box flex>
        <Input
          label={label}
          value={text}
          onChangeText={setText}
          keyboardType="number-pad"
          returnKeyType="go"
          onSubmitEditing={submit}
          {...(inputTestID !== undefined && { testID: inputTestID })}
        />
      </Box>
      <Button
        label={submitLabel}
        onPress={submit}
        variant="secondary"
        {...(submitTestID !== undefined && { testID: submitTestID })}
      />
    </Row>
  );
}
