import React, { useState, useEffect } from 'react';
import { ThemeContext } from './ThemeContext';
import { THEMES, THEME_STORAGE_KEY } from './themeConstants';

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved && Object.values(THEMES).includes(saved)) {
        return saved;
      }
    } catch {
      // ignore storage access errors
    }
    return THEMES.TACTICAL_DARK;
  });

  const setTheme = (newTheme) => {
    if (Object.values(THEMES).includes(newTheme)) {
      setThemeState(newTheme);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, newTheme);
      } catch {
        // ignore
      }
    }
  };

  const cycleTheme = () => {
    const list = [THEMES.TACTICAL_DARK, THEMES.OLED_DARK, THEMES.LIGHT];
    const currentIndex = list.indexOf(theme);
    const nextTheme = list[(currentIndex + 1) % list.length];
    setTheme(nextTheme);
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
