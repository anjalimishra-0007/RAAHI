import { createContext } from 'react';
import { THEMES } from './themeConstants';

export const ThemeContext = createContext({
  theme: THEMES.TACTICAL_DARK,
  setTheme: () => {},
  cycleTheme: () => {},
});
