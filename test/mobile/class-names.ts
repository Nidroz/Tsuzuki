// nativewind does not turn className into styles in jest (no compiled stylesheet): src/ui tests
// assert the token -> class mapping on the className props the host components receive

interface WithProps {
  readonly props: Readonly<Record<string, unknown>>;
}

/** the classes of a host element's className prop (or another class prop), in order */
export const classesOf = (element: WithProps, prop = 'className'): string[] => {
  const value = element.props[prop];
  if (typeof value !== 'string') {
    throw new TypeError(`expected a string ${prop} prop, got ${typeof value}`);
  }
  return value.split(' ').filter((name) => name !== '');
};
