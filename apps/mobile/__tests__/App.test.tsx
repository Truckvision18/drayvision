import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import App from '../src/App';

describe('App', () => {
  it('launches to an empty map on the Plan screen, styled via our API tile proxy', () => {
    render(<App />);
    expect(screen.getByTestId('plan-screen')).toBeTruthy();
    const map = screen.getByTestId('map-view');
    expect(map.props.mapStyle).toMatch(/\/tiles\/style\.json$/);
    expect(map.props.mapStyle).not.toMatch(/maptiler|key=/i);
  });

  it('switches between the five screens', () => {
    render(<App />);
    for (const [tab, id] of [
      ['navigate', 'screen-Navigate'],
      ['kbyg', 'screen-KnowBeforeYouGo'],
      ['facilities', 'screen-Facilities'],
      ['settings', 'screen-Settings'],
      ['plan', 'plan-screen'],
    ] as const) {
      fireEvent.press(screen.getByTestId(`tab-${tab}`));
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });
});
