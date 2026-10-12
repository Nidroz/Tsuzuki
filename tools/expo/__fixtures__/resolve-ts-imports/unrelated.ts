// typescript outside the app config graph: its extensionless import is retried, its format kept
import { dependency } from './unrelated-dependency';

export const unrelated = dependency;
