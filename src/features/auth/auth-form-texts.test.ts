import { describe, expect, it } from '@jest/globals';
import { useTranslation, type Translation } from '@core/i18n/index';
import type { AuthFormField, AuthFormProblem } from '@core/schemas/auth-forms';
import { renderHook } from '@testing-library/react-native';

import { providersFor } from '../../../test/mobile/render-with-providers';
import { formProblemText } from './auth-form-texts';

// the real english catalog: a missing key fails the test
const englishT = async (): Promise<Translation['t']> => {
  const { result } = await renderHook(useTranslation, { wrapper: providersFor() });
  return result.current.t;
};

describe('formProblemText', () => {
  it.each<[AuthFormField, AuthFormProblem, string]>([
    ['email', 'invalid', 'Enter a valid email address.'],
    ['password', 'invalid', 'Enter a valid password.'],
    ['passwordConfirmation', 'invalid', 'Type the password again.'],
  ])('translates the %s %s problem', async (field, problem, text) => {
    expect(formProblemText(await englishT(), field, problem)).toBe(text);
  });

  it.each<[AuthFormField, AuthFormProblem, string]>([
    ['email', 'missing-digit', 'Enter a valid email address.'],
    ['password', 'mismatch', 'Enter a valid password.'],
    ['passwordConfirmation', 'too-short', 'Type the password again.'],
  ])('falls back to the invalid text of %s for %s', async (field, problem, text) => {
    expect(formProblemText(await englishT(), field, problem)).toBe(text);
  });
});
