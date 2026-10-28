# AI Voice Torture Test

**Compare text-to-speech APIs side by side, measure speed and cost, and fix the words they get wrong.**

AI Voice Torture Test is a small, self-hosted test bench for evaluating and comparing TTS providers by ear and by the numbers. Paste a script (or use a built-in "torture test"), play it through ElevenLabs, Cartesia, Deepgram, OpenAI, and Google Gemini, and compare latency, cost, and how each voice handles difficult issues like numbers, acronyms, names, and emphasis. When a voice mispronounces your name or your company's, add the word once and the app applies the fix in whatever format each provider's API supports.

![AI Voice Torture Test: ElevenLabs, Cartesia, Deepgram, OpenAI, and Google Gemini reading the same Units and symbols test, each take showing a waveform, speed, and cost](docs/images/takes.jpg)

**[Try the hosted demo →](https://ai-voice-torture-test.vercel.app/)** Listen to every provider read all eight torture tests, with speed and cost for each take. No sign-up or API key needed; to generate your own audio, run it locally (below).

## Why I built this

I've had to evaluate text-to-speech providers more than once, first for podcast production and later at Traice Labs, a startup building AI personas, where the voice carried much of each persona's personality. Each time, comparing providers meant juggling playgrounds, browser tabs, and spreadsheets, and the questions that mattered were hard to answer side by side:

- How quickly does it start talking?
- What will it cost at scale?
- Does it read "$1.5M", "03/04", and "NASA" the way a real person would?
- When it mispronounces a name, what can I actually do about it, and is that different for every API? (It is different.)

Voice is fast becoming one of the main ways people experience AI, so I built the tool I kept wishing I had: one script compared across several providers at once, with the measurements next to the audio and a single place to fix pronunciation that works across all of them.

The different voice providers vary in many ways: speed, reliability, quality, cost, etc. In my own runs so far, Gemini and ElevenLabs were the slowest to start speaking, partly because my setup waits for their whole file rather than streaming it. I also look forward to testing additional providers (Google Cloud Text-to-Speech, Amazon Polly) and open-source voice models.

*Greg Helmstetter: three-time startup cofounder and product leader who has shipped AI-native products, with a background in psychology and an interest in where voice and personality meet.*
Read the write-up: [I built a torture test for AI voices](https://ghelmstetter.substack.com/p/i-built-a-torture-test-for-ai-voices) on *Hidden States*.

## Features

- **Side-by-side takes** from five providers on the same text, with click-to-seek waveforms.
- **Per-take stats:** time to first audio, total time, real-time factor, characters, and estimated cost, with the fastest and cheapest marked.
- **Eight test presets** aimed at known TTS weak spots: numbers and money, acronyms, homographs, names and brands, URLs and code, emphasis, units and symbols, and long sentences.
- **Write test text with Claude:** torture tests, natural paragraphs, dialogue, or sentences built around your own problem words.
- **One pronunciation list, five APIs.** Enter a word with a sounds-like spelling and/or IPA (Claude can suggest the IPA). The app translates it into each provider's mechanism and shows exactly what was sent.
- **Provider tips:** workarounds from each provider's docs for pauses, emphasis, spelling things out, and numbers, with copyable examples.
- **Blind test:** shuffle the takes, hide who made them, pick the best by ear, then reveal. Votes are kept on disk and summed on a results page.
- **Public-demo ready:** a free Samples mode with pre-recorded takes (to avoid burning tokens), plus an optional passcode, per-visitor limits, and a daily budget for live generation.
- **No dependencies.** Plain Node.js; nothing to `npm install`.

### How one pronunciation fix becomes five

Every provider has its own way of fixing pronunciation, so the app turns one saved dictionary entry (pronunciation overrides) into five different provider-specific instructions. The table below uses Saucony, the running-shoe brand, as the example: it's pronounced "SOCK-uh-nee", but people and TTS voices often say "saw-CONE-ee", which makes this word a good real-world test.

| Provider | IPA available | Sounds-like only |
|---|---|---|
| **ElevenLabs** | Eleven v4: inline `/ˈsɑkəni/` · Flash v2: `<phoneme alphabet="ipa">` tag · other models: respelling | respelling (same effect as an alias rule) |
| **Cartesia** | inline `<<ˈ\|s\|ɑ\|k\|ə\|n\|i>>` | sounds-like spelling |
| **Deepgram** | inline `\{"word": "Saucony", "pronounce": "ˈsɑkəni"\}` | respelling |
| **OpenAI** | a line in the `instructions` prompt (gpt-4o-mini-tts) | respelling |
| **Google Gemini** | a line in the Style prompt | respelling |

![The Pronunciations panel: a saved fix for nVidia with a chip per provider showing which method each one gets, and Saucony being added](docs/images/pronunciations.jpg)

## Quick start

### 1. Install Node.js

You need **Node.js 20.12 or newer**. Check with `node -v` in a terminal. If it's missing or older, install the **LTS** version from [nodejs.org](https://nodejs.org).

### 2. Get the code

Either **download it**: click the green **Code** button on this page → **Download ZIP**, and unzip it anywhere.

Or **clone it** with git:

```bash
git clone https://github.com/ghelmstetter/ai-voice-torture-test.git
cd ai-voice-torture-test
```

### 3. Add your API keys

Copy `.env.example` to a new file named `.env` and paste in the keys you have. Any provider you leave blank is simply hidden. Start with one; Deepgram's free starter credit is the easiest.

| Provider | Get a key | Free allowance* |
|---|---|---|
| Deepgram | [console.deepgram.com](https://console.deepgram.com) | $200 one-time credit |
| Cartesia | [play.cartesia.ai](https://play.cartesia.ai) → API Keys | 20K characters/month (non-commercial) |
| ElevenLabs | [elevenlabs.io](https://elevenlabs.io) → profile → API Keys | ~10K characters/month (attribution required) |
| OpenAI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | none; prepaid credit required |
| Google Gemini | [aistudio.google.com](https://aistudio.google.com) → Get API key | free tier with rate limits (Google may use free-tier data to improve its products) |
| Anthropic (Claude) | [platform.claude.com](https://platform.claude.com) → API Keys | none; prepaid credit required |

<sub>*As of October 2026. Check each provider's pricing page.</sub>

**Keep `.env` private.** It holds your keys and is listed in `.gitignore` so git won't upload it. Don't put it in a shared folder.

### 4. Start the app

- **Windows:** double-click `start.bat`. On first run it creates `.env` from the example and opens it in Notepad. Add your keys, save, and run `start.bat` again.
- **macOS / Linux / any terminal:**
  ```bash
  npm start
  ```

Then open **http://localhost:5178**. Keep the terminal window open while you use the app; closing it stops the server. After editing `.env`, restart the app.

### 5. Try it

Script → **Test presets** → **Numbers and money** → **Generate**. Then read the **[user guide](docs/USER-GUIDE.md)** for everything else.

## Configuration

All settings live in `.env` (see `.env.example`):

| Setting | Purpose |
|---|---|
| `ELEVENLABS_API_KEY`, `CARTESIA_API_KEY`, `DEEPGRAM_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` | Provider keys. Blank = provider hidden. |
| `ANTHROPIC_API_KEY` | Enables "Ask Claude" and "Suggest IPA with Claude". |
| `ANTHROPIC_WORKSPACE_ID` | Only if Claude says your key "is not scoped to a workspace". |
| `CLAUDE_MODEL` | Defaults to `claude-haiku-5-5`. |
| `PORT` | Defaults to `5178`. |
| `MAX_TEXT_CHARS` | Script length limit (default 1,500). |
| `LIVE_MODE=off` | Visitors can only play Samples. |
| `LIVE_PASSCODE` | Live generation requires this passcode. |
| `DAILY_REQUESTS_PER_IP` | Max live requests per visitor per day. |
| `DAILY_CHAR_BUDGET` | Max characters synthesized per day, across everyone. |
| `MOCK_PROVIDER=1` | Adds three "Test tone" providers that need no key, for trying the UI (three, so a blind test has something to shuffle). |
| `CARTESIA_DEMO_VOICE` | Cartesia voice used when recording Samples. |

## Blind test

Numbers and names tell you whether a voice is *right*; whether it *sounds* right is easier to judge when you don't know whose it is. Tick **Blind test** next to **Generate** (it's remembered, like the other settings) and run two or more voices:

- The takes come back shuffled and labelled **A, B, C…**, with only a waveform, play control and clip length. Provider, model, voice, timings, cost, "what was sent" and warnings are all withheld, and the lineup is sent to the server in one request so the browser never learns which take is whose; nothing in the page (element ids, classes, audio URLs, download names) can give one away.
- Under the run, pick the **best** take (required), optionally **rank** the others, tick **Numbers wrong** on any take where you heard a number, unit or name read incorrectly, add a note and your name, and **Submit vote and reveal**. The identities then appear and stay; a run takes exactly one vote.
- Every vote is appended as one JSON line to `results/votes.jsonl` next to the app (created on first vote; ignored by git), with the script and a sha256 of it (whitespace collapsed, so the same script pasted with different line breaks groups together), the takes in the order shown with their letter and full identity (provider, model, voice, options), the pick, the ranking, the numbers-wrong flags and the note. Delete a line to retract a vote.
- **Results** (top right, or `/results`) sums the file: appearances, wins, win rate, numbers-wrong count and mean rank per voice, model or provider; filters by voter and by script; and a head-to-head of any two identities showing how often each was picked when both were in the same run.

A blind run counts against the daily limits like one Generate per take. Pending (unvoted) runs are held in the server's memory, so a restart means generating again; recorded votes survive restarts. With `MOCK_PROVIDER=1` the three Test tone providers each default to a different tone, so the blind test can be tried without any key.

## Running a public demo

Anyone who clicks **Generate** on a public copy spends your API credit, so:

1. **Record Samples** once with `npm run build-demo` (about 1,700 characters per provider). Visitors can then compare every provider on every preset for free.
2. **Protect live generation** with `LIVE_MODE=off`, or with `LIVE_PASSCODE` plus `DAILY_REQUESTS_PER_IP` and `DAILY_CHAR_BUDGET`. To give someone live access, send a link ending in `?code=yourpasscode`; it fills in the passcode for them. Change the passcode to turn old links off.

Rate limits are kept in memory and reset when the server restarts. `server/index.js` exports a plain Node `handler(req, res)`, so the app can be wrapped for most hosts.

**Hosting on Vercel (free Hobby plan):** the repo includes `vercel.json` and `api/index.js`, so you can import it at [vercel.com](https://vercel.com) with Framework Preset **Other** and the Root Directory left as `./`. Add the environment variable `LIVE_MODE=off` for a Samples-only demo that needs no API keys. On serverless hosts the in-memory limits don't hold across instances, so if you enable live generation there, also set spending limits with your providers.

## Adding a provider

Each provider is one file in `server/providers/`.

1. Copy `server/providers/openai.js` to a new file.
2. Fill in:
   - `models` (with list prices),
   - `fallbackVoices`,
   - `compile()`: how a pronunciation entry becomes text this API understands,
   - `synthesize()`: the API call, wrapped in `timedFetch()` so latency is measured the same way,
   - `tips` from the provider's docs.
3. Add one import line to `server/providers/index.js` and the key name to `.env.example`.

## Project structure

```
server/
  index.js          HTTP server and API routes
  synthesize.js     applies pronunciations, calls a provider, returns audio + metrics
  claude.js         test-text generation and IPA suggestions
  guard.js          passcode, rate limits, daily budget
  blind.js          blind runs, vote recording, results reading
  providers/        one file per provider, plus shared helpers
public/
  index.html, styles.css, app.js    the interface (vanilla JS, no build step)
  results.html, results.js, tally.js  blind-test results page and the vote arithmetic
  presets.js        test passages (shared with build-demo)
  demo/             recorded Samples
scripts/
  build-demo.js     records Samples
docs/
  USER-GUIDE.md     full walkthrough
results/
  votes.jsonl       blind-test votes, one per line (created on first vote; not in git)
```

## Notes and limits

- **Prices and models change often.** The prices in the app are list prices from October 2026 and are for comparison only. Your bill is set by your provider plan. The app doesn't fetch prices from the providers (their speech APIs don't publish them); each price is written into that provider's file in `server/providers/` (look for `price:` next to each model) and can be updated there when a provider changes its pricing.
- **Latency is measured from the server to the provider.** On your own computer that includes your internet connection.
- **Your settings stay local.** Pronunciations and preferences are stored in your browser and survive closing the app; keys stay on your server and are never sent to the browser. 
- **AI voice disclosure.** Some providers (OpenAI, for example) require telling listeners that a voice is AI-generated if you publish the audio.
- This project isn't affiliated with or endorsed by any of the providers. Product names are trademarks of their owners.

## Roadmap

Ideas for turning this hands-on test bench into a more complete evaluation tool:

- **Automatic accuracy check:** transcribe each take with speech-to-text and score it against the script (word error rate), to catch "two thousand twenty-six dollars" automatically.
- **Saved results:** keep runs across sessions and export them as CSV or JSON.
- **Repeat runs:** run each provider several times and report median and worst-case latency.
- **More providers:** Google Cloud, Azure AI Speech, Amazon Polly, Hume, and local open-source models such as Kokoro.
- **Speech-to-text torture tests:** TTS is only half of a spoken conversation with AI; transcription is the other half.

## Contributing

This is a personal project, shared as-is. Bug reports and suggestions are welcome as issues; I may not be able to review pull requests promptly.

## Credits

Built by Greg Helmstetter with [Claude](https://claude.ai), which researched the provider APIs, wrote the code, and drafted the docs.

## License

[MIT](LICENSE) © 2026 Greg Helmstetter. You're free to use, change, and share this code, including commercially, as long as the copyright notice stays with it.
