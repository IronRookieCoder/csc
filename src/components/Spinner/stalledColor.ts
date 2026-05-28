import type { Color } from '@anthropic/ink';
import type { Theme, ThemeName } from '../../utils/theme.js';
import { isMatrixTacticalTheme } from '../../utils/matrixTacticalPresentation.js';
import { interpolateColor, parseRGB, toRGBColor } from './utils.js';

const ERROR_RED = { r: 171, g: 43, b: 63 };

type StalledSpinnerColorArgs = {
  themeName: ThemeName;
  theme: Theme;
  messageColor: keyof Theme;
  stalledIntensity: number;
};

export function getStalledSpinnerColor({
  themeName,
  theme,
  messageColor,
  stalledIntensity,
}: StalledSpinnerColorArgs): keyof Theme | Color {
  const baseColorStr = theme[messageColor];
  const baseRGB = baseColorStr ? parseRGB(baseColorStr) : null;

  if (isMatrixTacticalTheme(themeName)) {
    return baseRGB ? toRGBColor(baseRGB) : messageColor;
  }

  if (baseRGB) {
    return toRGBColor(interpolateColor(baseRGB, ERROR_RED, stalledIntensity));
  }

  return stalledIntensity > 0.5 ? 'error' : messageColor;
}
