import { zhTW, type Messages } from './zh-TW';

export const messages: Messages = zhTW;

/** Fill {placeholders} in a message. */
export function fmt(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? ''));
}
