import { useTranslation } from '@core/i18n/index';
import {
  AUTH_FORM_FIELDS,
  parseAuthForm,
  type AuthFormField,
  type AuthFormProblem,
  type AuthFormProblems,
} from '@core/schemas/auth-forms';
import { useState } from 'react';
import type { ZodType } from 'zod';

import { formProblemText } from './auth-form-texts';

type AuthFormValues = Readonly<Record<AuthFormField, string>>;

const EMPTY_VALUES: AuthFormValues = { email: '', password: '', passwordConfirmation: '' };
const NO_PROBLEMS: AuthFormProblems = {};

const withoutProblem = (problems: AuthFormProblems, field: AuthFormField): AuthFormProblems => {
  if (problems[field] === undefined) {
    return problems;
  }
  const rest: Partial<Record<AuthFormField, AuthFormProblem>> = {};
  for (const other of AUTH_FORM_FIELDS) {
    const problem = problems[other];
    if (other !== field && problem !== undefined) {
      rest[other] = problem;
    }
  }
  return rest;
};

/**
 * the text fields of an auth form, parsed with `schema` on submit only: `validate` shows the
 * translated problem of each rejected field and returns the parsed value, or null. typing in a
 * field clears its problem. the values stay in this state only: never logged or stored
 */
export const useAuthForm = <T>(schema: ZodType<T>) => {
  const { t } = useTranslation();
  const [values, setValues] = useState(EMPTY_VALUES);
  const [problems, setProblems] = useState(NO_PROBLEMS);

  const change = (field: AuthFormField) => (text: string) => {
    setValues((current) => ({ ...current, [field]: text }));
    setProblems((current) => withoutProblem(current, field));
  };

  /** the translated problem of `field`, empty without one (the Input shows no error then) */
  const errorOf = (field: AuthFormField): string => {
    const problem = problems[field];
    return problem === undefined ? '' : formProblemText(t, field, problem);
  };

  const validate = (): T | null => {
    const result = parseAuthForm(schema, values);
    if (!result.success) {
      setProblems(result.problems);
      return null;
    }
    setProblems(NO_PROBLEMS);
    return result.value;
  };

  return { values, change, errorOf, validate };
};
