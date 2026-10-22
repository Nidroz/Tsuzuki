import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
} from '@core/domain/auth-credentials';
import type { Translation } from '@core/i18n/index';
import type { AuthFormField, AuthFormProblem } from '@core/schemas/auth-forms';

type Translate = Translation['t'];
type ProblemText = (t: Translate) => string;

// the problems each field can have, with `invalid` as the fallback of any other problem. the
// policy numbers come from the domain constants, so the texts follow the policy
type FieldProblemTexts = Readonly<Partial<Record<AuthFormProblem, ProblemText>>> & {
  readonly invalid: ProblemText;
};

const FIELD_PROBLEM_TEXTS: Readonly<Record<AuthFormField, FieldProblemTexts>> = {
  email: {
    required: (t) => t('auth.form.email.required'),
    invalid: (t) => t('auth.form.email.invalid'),
    'too-long': (t) => t('auth.form.email.tooLong', { max: EMAIL_MAX_LENGTH }),
  },
  password: {
    required: (t) => t('auth.form.password.required'),
    invalid: (t) => t('auth.form.password.invalid'),
    'too-short': (t) => t('auth.form.password.tooShort', { min: PASSWORD_MIN_LENGTH }),
    'too-long': (t) => t('auth.form.password.tooLong', { max: PASSWORD_MAX_BYTES }),
    'missing-letter': (t) => t('auth.form.password.missingLetter'),
    'missing-digit': (t) => t('auth.form.password.missingDigit'),
  },
  passwordConfirmation: {
    required: (t) => t('auth.form.passwordConfirmation.required'),
    invalid: (t) => t('auth.form.passwordConfirmation.invalid'),
    mismatch: (t) => t('auth.form.passwordConfirmation.mismatch'),
  },
};

/** the translated text of a field problem (AuthFormProblem, src/core/schemas/auth-forms.ts) */
export const formProblemText = (
  t: Translate,
  field: AuthFormField,
  problem: AuthFormProblem,
): string => {
  const texts = FIELD_PROBLEM_TEXTS[field];
  return (texts[problem] ?? texts.invalid)(t);
};

/** the password policy hint under a new password field */
export const passwordPolicyText = (t: Translate): string =>
  t('auth.form.passwordPolicy', { min: PASSWORD_MIN_LENGTH });
