// Provider registry. To add a provider: create a file next to this one that
// follows the same shape as openai.js, then add one import line below.
import elevenlabs from './elevenlabs.js';
import cartesia from './cartesia.js';
import deepgram from './deepgram.js';
import openai from './openai.js';
import gemini from './gemini.js';
import { mocks } from './mock.js';

const all = [elevenlabs, cartesia, deepgram, openai, gemini];
if (process.env.MOCK_PROVIDER === '1') all.push(...mocks);

export const providers = Object.fromEntries(all.map((p) => [p.id, p]));
export const providerList = all;

/** Names of the .env keys a provider needs (set envKeys in an adapter if it needs more than one). */
export const keyNames = (p) => p.envKeys || (p.envKey ? [p.envKey] : []);
/** True when every key the provider needs is set in .env. */
export const isConfigured = (p) => keyNames(p).every((k) => process.env[k]);
