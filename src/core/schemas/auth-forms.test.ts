import { describe, expect, it } from '@jest/globals';

import { EMAIL_MAX_LENGTH, PASSWORD_MAX_BYTES } from '../domain/auth-credentials';
import {
  emailFormSchema,
  emailSchema,
  newPasswordFormSchema,
  parseAuthForm,
  signInFormSchema,
  signUpFormSchema,
} from './auth-forms';

const EMAIL = 'reader@example.com';
const PASSWORD = 'correct-horse-9';
// code point U+1F600: four utf-8 bytes
const EMOJI = '\u{1F600}';

// an address of exactly `length` characters
const emailOfLength = (length: number): string => {
  const domain = '@example.com';
  return `${'a'.repeat(length - domain.length)}${domain}`;
};

describe('emailSchema', () => {
  it('trims the address', () => {
    expect(emailSchema.parse(`  ${EMAIL}\n`)).toBe(EMAIL);
  });

  it('accepts an address of the maximum length and rejects a longer one', () => {
    expect(
      parseAuthForm(emailFormSchema, { email: emailOfLength(EMAIL_MAX_LENGTH) }),
    ).toMatchObject({ success: true });
    expect(parseAuthForm(emailFormSchema, { email: emailOfLength(EMAIL_MAX_LENGTH + 1) })).toEqual({
      success: false,
      problems: { email: 'too-long' },
    });
  });

  it.each([
    ['an empty address', '', 'required'],
    ['blank text', '   ', 'required'],
    ['text without an at sign', 'reader.example.com', 'invalid'],
    ['an address without a domain', 'reader@', 'invalid'],
    ['an address with inner spaces', 'rea der@example.com', 'invalid'],
  ])('rejects %s', (_label, email, problem) => {
    expect(parseAuthForm(emailFormSchema, { email })).toEqual({
      success: false,
      problems: { email: problem },
    });
  });
});

describe('signInFormSchema', () => {
  it('gives the credentials, the email trimmed and the password as typed', () => {
    expect(parseAuthForm(signInFormSchema, { email: ` ${EMAIL} `, password: ' short ' })).toEqual({
      success: true,
      value: { email: EMAIL, password: ' short ' },
    });
  });

  it('checks no policy but the length the server accepts', () => {
    const longest = 'x'.repeat(PASSWORD_MAX_BYTES);

    expect(parseAuthForm(signInFormSchema, { email: EMAIL, password: longest })).toMatchObject({
      success: true,
    });
    expect(parseAuthForm(signInFormSchema, { email: EMAIL, password: `${longest}x` })).toEqual({
      success: false,
      problems: { password: 'too-long' },
    });
  });

  it('gives a problem for each rejected field', () => {
    expect(parseAuthForm(signInFormSchema, { email: '', password: '' })).toEqual({
      success: false,
      problems: { email: 'required', password: 'required' },
    });
  });
});

describe('signUpFormSchema', () => {
  const form = (password: string, passwordConfirmation = password) => ({
    email: EMAIL,
    password,
    passwordConfirmation,
  });

  it('gives the credentials without the confirmation', () => {
    expect(parseAuthForm(signUpFormSchema, form(PASSWORD))).toEqual({
      success: true,
      value: { email: EMAIL, password: PASSWORD },
    });
  });

  it.each([
    ['a short password', 'abc1', 'too-short'],
    ['a password without a digit', 'abcdefghijk', 'missing-digit'],
    ['a password without a letter', '12345678901', 'missing-letter'],
    ['a password over the byte bound', `a1${EMOJI.repeat(18)}`, 'too-long'],
  ])('rejects %s with its first policy problem', (_label, password, problem) => {
    expect(parseAuthForm(signUpFormSchema, form(password))).toEqual({
      success: false,
      problems: { password: problem },
    });
  });

  it('rejects a confirmation that differs, next to a password problem', () => {
    expect(parseAuthForm(signUpFormSchema, form(PASSWORD, `${PASSWORD} `))).toEqual({
      success: false,
      problems: { passwordConfirmation: 'mismatch' },
    });
    expect(parseAuthForm(signUpFormSchema, form('abc1', 'abc2'))).toEqual({
      success: false,
      problems: { password: 'too-short', passwordConfirmation: 'mismatch' },
    });
  });

  it('asks for an empty password and an empty confirmation', () => {
    expect(parseAuthForm(signUpFormSchema, form(''))).toEqual({
      success: false,
      problems: { password: 'required', passwordConfirmation: 'required' },
    });
  });

  it('asks for an empty confirmation instead of reporting a mismatch', () => {
    expect(parseAuthForm(signUpFormSchema, form(PASSWORD, ''))).toEqual({
      success: false,
      problems: { passwordConfirmation: 'required' },
    });
  });
});

describe('newPasswordFormSchema', () => {
  it('gives the new password as typed, without its confirmation', () => {
    expect(
      parseAuthForm(newPasswordFormSchema, { password: PASSWORD, passwordConfirmation: PASSWORD }),
    ).toEqual({ success: true, value: { password: PASSWORD } });
  });

  it('rejects a password outside the policy', () => {
    expect(
      parseAuthForm(newPasswordFormSchema, {
        password: 'abcdefghij',
        passwordConfirmation: 'abcdefghij',
      }),
    ).toEqual({ success: false, problems: { password: 'missing-digit' } });
  });

  it('rejects a confirmation that differs or is empty', () => {
    expect(
      parseAuthForm(newPasswordFormSchema, { password: PASSWORD, passwordConfirmation: 'other' }),
    ).toEqual({ success: false, problems: { passwordConfirmation: 'mismatch' } });
    expect(
      parseAuthForm(newPasswordFormSchema, { password: PASSWORD, passwordConfirmation: '' }),
    ).toEqual({ success: false, problems: { passwordConfirmation: 'required' } });
  });
});

describe('parseAuthForm', () => {
  it('reads unexpected input as invalid, never echoing it', () => {
    const result = parseAuthForm(signInFormSchema, { email: 42, password: ['x'] });

    expect(result).toEqual({ success: false, problems: { email: 'invalid', password: 'invalid' } });
  });

  it('gives no field problem for an input that is not a form object', () => {
    expect(parseAuthForm(emailFormSchema, null)).toEqual({ success: false, problems: {} });
  });
});
