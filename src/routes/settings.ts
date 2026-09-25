import { Hono, type Context } from 'hono';
import type {
  SettingsValidationRequest,
  SettingsValidationResponse,
} from '@devvit/web/shared';
import { validateTemplate, type TextKind } from '../template';

export const settingsRoutes = new Hono();

function validator(kind: TextKind) {
  return async (c: Context) => {
    let value: string | undefined;
    try {
      ({ value } = await c.req.json<SettingsValidationRequest<string>>());
    } catch {
      value = undefined;
    }
    const error = validateTemplate(value, kind);
    return c.json<SettingsValidationResponse>(
      error ? { success: false, error } : { success: true },
      200
    );
  };
}

settingsRoutes.post('/validate-request-text', validator('request'));
settingsRoutes.post('/validate-confirmed-text', validator('confirmed'));
