import { z } from 'zod';

import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_BYTES,
  PASSWORD_PROBLEMS,
  passwordProblems,
  utf8ByteLength,
  type PasswordProblem,
} from '../domain/auth-credentials';
import type { EmailCredentials } from '../repositories/auth-repository';

// the auth forms (docs/ARCHITECTURE.md §8): user input parsed before any auth call. a problem is a
// fixed code per field that the screen translates; issues never hold the typed value. the email is
// trimmed, the password never is

/** the fields of the auth forms. */
export const AUTH_FORM_FIELDS = ['email', 'password', 'passwordConfirmation'] as const;

export type AuthFormField = (typeof AUTH_FORM_FIELDS)[number];

/**
 * why a field is rejected: empty, not an email (`invalid`, also any unexpected input), a password
 * confirmation that differs (`mismatch`), or a password policy problem; `too-long` is also an
 * email over EMAIL_MAX_LENGTH.
 */
export type AuthFormProblem = 'required' | 'invalid' | 'mismatch' | PasswordProblem;

const AUTH_FORM_PROBLEMS: ReadonlySet<string> = new Set<AuthFormProblem>([
  'required',
  'invalid',
  'mismatch',
  ...PASSWORD_PROBLEMS,
]);

const FIELDS: ReadonlySet<unknown> = new Set<AuthFormField>(AUTH_FORM_FIELDS);

const isAuthFormField = (value: unknown): value is AuthFormField => FIELDS.has(value);

const isAuthFormProblem = (value: string): value is AuthFormProblem =>
  AUTH_FORM_PROBLEMS.has(value);

// a refinement adding the problem `problemOf` finds, as the issue message
const problemCheck =
  (problemOf: (value: string) => AuthFormProblem | null) =>
  (value: string, ctx: z.RefinementCtx): void => {
    const problem = problemOf(value);
    if (problem !== null) {
      ctx.addIssue({ code: 'custom', message: problem });
    }
  };

const emailFormatSchema = z.email();

const emailProblem = (email: string): AuthFormProblem | null => {
  if (email === '') {
    return 'required';
  }
  if (email.length > EMAIL_MAX_LENGTH) {
    return 'too-long';
  }
  return emailFormatSchema.safeParse(email).success ? null : 'invalid';
};

// sign in checks no policy (the server's), only what no account can have
const signInPasswordProblem = (password: string): AuthFormProblem | null => {
  if (password === '') {
    return 'required';
  }
  return utf8ByteLength(password) > PASSWORD_MAX_BYTES ? 'too-long' : null;
};

// the first policy problem, in PASSWORD_PROBLEMS order
const newPasswordProblem = (password: string): AuthFormProblem | null =>
  password === '' ? 'required' : (passwordProblems(password)[0] ?? null);

const confirmationProblem = (confirmation: string): AuthFormProblem | null =>
  confirmation === '' ? 'required' : null;

/** an email address: trimmed, at most EMAIL_MAX_LENGTH, a valid address. */
export const emailSchema = z.string().trim().superRefine(problemCheck(emailProblem));

const signInPasswordSchema = z.string().superRefine(problemCheck(signInPasswordProblem));

const newPasswordSchema = z.string().superRefine(problemCheck(newPasswordProblem));

const confirmationSchema = z.string().superRefine(problemCheck(confirmationProblem));

// a filled confirmation must equal the password; runs after the field checks, which do not abort
const confirmationMatches = (
  { password, passwordConfirmation }: { password: string; passwordConfirmation: string },
  ctx: z.RefinementCtx,
): void => {
  if (passwordConfirmation !== '' && passwordConfirmation !== password) {
    ctx.addIssue({ code: 'custom', message: 'mismatch', path: ['passwordConfirmation'] });
  }
};

/** the sign in form: an email and a non-empty password. */
export const signInFormSchema = z
  .object({ email: emailSchema, password: signInPasswordSchema })
  .transform(({ email, password }): EmailCredentials => ({ email, password }));

/** the sign up form: an email, a password meeting the policy and its confirmation. */
export const signUpFormSchema = z
  .object({
    email: emailSchema,
    password: newPasswordSchema,
    passwordConfirmation: confirmationSchema,
  })
  .superRefine(confirmationMatches)
  .transform(({ email, password }): EmailCredentials => ({ email, password }));

/** the forgot password and resend forms: an email. */
export const emailFormSchema = z.object({ email: emailSchema });

/**
 * the reset password form: a new password meeting the policy and its confirmation, since a typo
 * would cost another recovery email.
 */
export const newPasswordFormSchema = z
  .object({ password: newPasswordSchema, passwordConfirmation: confirmationSchema })
  .superRefine(confirmationMatches)
  .transform(({ password }) => ({ password }));

/** the first problem of each rejected field. */
export type AuthFormProblems = Readonly<Partial<Record<AuthFormField, AuthFormProblem>>>;

export type AuthFormResult<T> =
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly problems: AuthFormProblems };

const toProblem = (issue: z.core.$ZodIssue): AuthFormProblem =>
  issue.code === 'custom' && isAuthFormProblem(issue.message) ? issue.message : 'invalid';

/**
 * parses form values with one of the auth form schemas: the value, or the first problem of each
 * rejected field (an input that is not an object of the form's fields has no field problem).
 */
export const parseAuthForm = <T>(schema: z.ZodType<T>, input: unknown): AuthFormResult<T> => {
  const result = schema.safeParse(input);
  if (result.success) {
    return { success: true, value: result.data };
  }
  const problems: Partial<Record<AuthFormField, AuthFormProblem>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (isAuthFormField(field) && problems[field] === undefined) {
      problems[field] = toProblem(issue);
    }
  }
  return { success: false, problems };
};
