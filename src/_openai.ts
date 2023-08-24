import OpenAI from 'openai';
import * as functions from 'firebase-functions';

export const openai = new OpenAI({
  organization: functions.config().openai.organization,
  apiKey: functions.config().openai.api_key,
});
