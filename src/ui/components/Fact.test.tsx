import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { Fact } from './Fact';

const TEST_ID = 'fact';
const LABEL = 'Format';
const VALUE = 'TV';

describe('Fact', () => {
  it('renders its label above its value, the label as a muted caption', async () => {
    await render(<Fact label={LABEL} value={VALUE} testID={TEST_ID} />);

    const label = screen.getByText(LABEL);
    const value = screen.getByText(VALUE);

    expect(classesOf(label)).toStrictEqual(['text-caption', 'text-text-muted']);
    expect(classesOf(value)).toStrictEqual(['text-body', 'text-text']);
    expect(screen.getByTestId(TEST_ID)).toContainElement(label);
    expect(screen.getByTestId(TEST_ID)).toContainElement(value);
  });

  it('is one accessible element read as "label, value"', async () => {
    await render(<Fact label={LABEL} value={VALUE} testID={TEST_ID} />);

    const fact = screen.getByLabelText('Format, TV');

    expect(fact).toHaveProp('testID', TEST_ID);
    expect(fact).toHaveProp('accessible', true);
  });

  it('renders without a testID', async () => {
    await render(<Fact label="Score" value="9.24" />);

    expect(screen.getByLabelText('Score, 9.24')).toBeOnTheScreen();
  });
});
