# AI Voice Torture Test: user guide

This guide walks through the app one area at a time. For installation, see the [README](../README.md#quick-start).

- [1. The top bar](#1-the-top-bar)
- [2. Script](#2-script)
- [3. Voices](#3-voices)
- [4. Takes](#4-takes)
- [5. Pronunciations](#5-pronunciations)
- [6. Provider tips](#6-provider-tips)
- [7. Samples (pre-recorded takes)](#7-samples-pre-recorded-takes)
- [Troubleshooting](#troubleshooting)

---

## 1. The top bar

| Control | What it does |
|---|---|
| **Live / Samples** | **Live** is the workspace: write text, pick voices, generate new audio. Each generation spends a little API credit. **Samples** plays pre-recorded takes of the test presets at no cost (see [section 7](#7-samples-pre-recorded-takes)). |
| **Pronunciations (n)** | Opens the panel where you teach the app how to say words the voices get wrong. The number is how many you've saved. |
| **Provider tips** | Opens workarounds collected from each provider's documentation. |

Close side panels with **✕**, the **Esc** key, or by clicking the dimmed page behind them.

The app remembers your text, which voices are on, and your pronunciations **in this browser only**. Use **Export / Import** in the Pronunciations panel to move your word list to another browser or computer.

---

## 2. Script

The left panel sets what the voices will say. **The large text box is always what gets spoken**; the four tabs are just different ways to fill it.

**Write**: type or paste anything. You can also edit whatever a preset, Claude or a file puts in the box.

**Test presets**: eight passages, each aimed at a known weak spot of TTS models:

| Preset | What it checks |
|---|---|
| Numbers and money | dates (is 03/04 March 4 or April 3?), $1.5M, percentages, phone numbers, "ext. 3", 5:30pm MST |
| Acronyms and initialisms | which get spelled out (FBI, SQL) vs. said as words (NASA, GIF) |
| Homographs | same spelling, different sound: read/read, lead/lead, wind/wind, bass/bass, polish/Polish |
| Names and brands | Siobhan, Nguyen, Worcester, Moët, Hermès, Xiaomi, Saucony |
| URLs, emails and code | @, slashes, `?id=42#auth`, `npm i -D`, `~/src && ls` |
| Emphasis and tone | "I didn't say SHE stole it", "Wait... you're serious?", "(Quietly)" |
| Units and symbols | 3/4 cup, 350°F, 25–30 min, ±0.5 mm, CO₂, 22nd |
| Long sentence | breath, pacing and pitch across one very long sentence |

Clicking a card loads its text. The card stays outlined until you edit the text.

**Ask Claude** (needs `ANTHROPIC_API_KEY`):
1. Pick a kind of text: **Torture test** (packed with tricky items), **Use my pronunciation words** (works your saved words into several positions in a sentence), **Natural paragraph**, or **Short dialogue**.
2. Optionally add a topic.
3. Click **Write it with Claude**. The result replaces the text in the box, and a note shows the model, time and tokens used.

**Upload**: drag a `.txt` or `.md` file onto the box, or click to choose one. Long files are cut to the character limit.

**Below the box:**
- **Character count**: turns red past the limit (1,500 by default; change with `MAX_TEXT_CHARS` in `.env`). Cost scales with characters.
- **Pronunciation fixes in use**: chips for saved pronunciation words found in your text.

> **Try:** load **Homographs** or **Emphasis and tone**. They usually show the biggest differences between providers.

---

## 3. Voices

The right panel chooses who speaks and how.

**Provider rows.** Each provider has its own color, which also marks its takes. The switch includes it in the next run. A row reading **"Needs XYZ_API_KEY"** stays greyed out until that key is in `.env`.

When a provider is on, its row shows:

- **Model.** The note under the pickers sums up that model's strengths and pronunciation support. The model can change how a pronunciation fix is applied (for example, ElevenLabs v4 gets inline IPA while Multilingual v2 gets a respelling).
- **Voice.**
  - ElevenLabs and Cartesia load the voices in your account (with a few defaults as fallback).
  - Deepgram, OpenAI and Google Gemini use built-in lists. Gemini shows each voice's character (Firm, Warm, Gravelly and so on).
  - Deepgram voices belong to a model, so the list changes when you switch between Aura-2 and Flux.
  - OpenAI's `tts-1` models have 9 of the 13 voices. Picking Marin or Cedar with them falls back to Alloy, with a warning.
- **Extra controls**, only where the API supports them:
  - **OpenAI → Instructions** (gpt-4o-mini-tts only): plain-English direction such as *"Calm narrator, slight smile, slow down on numbers."* This prompt is OpenAI's main lever for tone and pronunciation.
  - **OpenAI Realtime → Instructions**: the same idea for `gpt-realtime-2.1-mini` / `gpt-realtime-2.1` (the Realtime API models that replace `tts-1`, `tts-1-hd` and `gpt-4o-mini-tts` from 2027-01-06). It is sent as the session's system prompt ahead of a fixed "read this exactly as written" line. These are chat models reading your text, so each take also shows the **transcript** of what the model actually said, and its cost is metered from the usage the API reports rather than estimated. Needs Node 22 or newer.
  - **Cartesia → Emotion (beta)**: calm, content, excited, sad, angry and more.
  - **Google Gemini → Style**: plain-English direction for tone, emotion and pace, such as *"Warm and unhurried, like a late-night radio host."* Gemini reads the script word for word, so directions belong here, not in the text.

**Speed slider** (top right) applies to every provider except Google Gemini, which has no speed setting (ask for a pace in its Style box instead). Speed is held within each one's allowed range: ElevenLabs 0.7–1.2×, Cartesia 0.6–1.5×, Deepgram 0.7–1.5×. Deepgram Flux can't combine speed with a pronunciation override, so it uses 1.0× in that case and says so.

**Preview what's sent** shows, for each provider, the exact text it will receive after pronunciation fixes, and which fix each word got. It's free: nothing is generated.

**Generate N takes · ~$0.00X** runs every switched-on provider at the same time. The cost is an estimate from list prices and character count. (OpenAI's gpt-4o-mini-tts and Google Gemini are priced per audio minute, estimated at about 15 characters per second.)

A **Passcode** field appears above Generate only if `LIVE_PASSCODE` is set in `.env`. On a hosted copy, a link ending in `?code=yourpasscode` fills it in automatically. If the passcode is missing or wrong, a message appears next to the field and nothing is generated.

---

## 4. Takes

![One run with five takes: each shows a waveform, first-audio time, total time, audio length, real-time factor, characters and estimated cost](images/takes.jpg)

Each **Generate** adds a run at the top: the text, the time and speed, then one card per provider. While a card waits, a light sweeps across it. If a provider fails, its card shows the error; the others still finish.

**Waveform.** Press the play button, or **click anywhere on the waveform** to jump there, which is handy for replaying the exact moment a voice stumbled. Only one take plays at a time.

**Stats:**

| Stat | Meaning | What's good |
|---|---|---|
| **First audio** | Time from request to the first audio byte (measured from the app's server to the provider). The key number for live voice agents. | Under ~300 ms feels instant |
| **Total time** | Until the whole clip arrived | Lower |
| **Audio length** | Clip duration | — |
| **Real-time factor** | Total time ÷ audio length | Below 1× = faster than real time |
| **Characters** | Characters sent. Shows "of N typed" when pronunciation fixes changed the length. | — |
| **Est. cost** | List price × characters (gpt-4o-mini-tts: × audio minutes) | — |

With two or more takes, **fastest** and **cheapest** badges mark the winners. Timings vary with network and provider load, so run the same text a few times before drawing conclusions. All providers run in parallel under the same conditions.

**What was sent** (expand it):
- **Text**: exactly what the provider received, including any tags or respellings the app added.
- **Fixes**: which method was used for each saved word, or why none was.
- **Warnings**: for example, "This model ignores `<break>` tags" or "speed was left at 1.0".
- **Provider report**: Deepgram returns which pronunciations it actually applied, plus warning codes. OpenAI Realtime reports the response status, the token usage and the cost arithmetic.
- **Request settings**: model, voice, speed and options.
- **Download audio**: saves the clip.

**Takes aren't saved.** Refreshing the page clears them, so download any you want to keep.

---

## 5. Pronunciations

![The Pronunciations panel: a saved fix for nVidia, with Saucony being added](images/pronunciations.jpg)

For the "it keeps saying my company's name wrong" problem. Open it from **Pronunciations** in the top bar.

**Add a word:**

| Field | What to put | Example |
|---|---|---|
| **Word or phrase** | The text as it appears in your script (several words are fine) | `Saucony` |
| **Sounds like** | A plain respelling, stressed syllable in CAPITALS | `SOCK-uh-nee` |
| **IPA** (optional) | Phonetic spelling. Slashes are stripped. | `ˈsɑkəni` |
| **Match case exactly** | Only fix this exact capitalization (off by default) | — |

You need at least one of **Sounds like** or **IPA**; both is best. IPA is precise and is used wherever a provider accepts phonetic spellings. Sounds like works everywhere and is the fallback.

**Suggest IPA with Claude.** Type the word (and ideally your sounds-like spelling) and click it. Claude fills in the IPA, plus a sounds-like spelling if that field is empty. If you gave a sounds-like spelling, Claude follows it rather than the "standard" pronunciation. Always check by ear.

**The chips under each saved word** show how each provider will apply the fix, given the model currently selected in Voices:

| Provider | With IPA | Without IPA |
|---|---|---|
| ElevenLabs | v4: inline `/IPA/` · Flash v2: `<phoneme>` tag (single words) · other models: respelling | respelling |
| Cartesia | inline `<<ˈ|s|ɑ|k|ə|n|i>>` phonemes | respelling |
| Deepgram | inline IPA override | respelling |
| OpenAI | added to **Instructions** (gpt-4o-mini-tts) | respelling |
| Google Gemini | added to **Style** | respelling |

A **dashed "no fix" chip** means that provider can't use what you've entered. Hover to see why, then fill in the other field.

**Per word:** **Test** puts the word into a sample sentence in the Script box; **Edit**; **Delete**. **Export / Import** at the bottom saves or loads `pronunciations.json` (importing a word you already have replaces it).

**How fixes are applied.** Whenever a saved word appears in your script, its fix is applied automatically, to whole words only. Longer phrases go first, so "Saucony Ride" is handled before "Saucony".

**A good loop:**
1. Generate and hear a voice get a word wrong.
2. Add the word, then click **Test**.
3. Click **Preview what's sent** to see the fix each provider gets.
4. Generate and compare. If one provider is still wrong, adjust the respelling (try different stress, like `sock-UH-nee` vs `SOCK-uh-nee`) or the IPA, and check that take's **What was sent** and **Provider report**.

---

## 6. Provider tips

![The Provider tips panel for ElevenLabs: how fixes are applied, model prices and tips from the docs](images/provider-tips.jpg)

Open from **Provider tips** in the top bar. Each provider tab has:

1. **How this app applies your fixes** for that provider.
2. **A model table** with list prices and what each model is good or weak at.
3. **Tips** from the provider's docs (phonemes, aliases, pauses, spelling out codes, emphasis, numbers), most with a copyable example.
4. **Links** to the source docs.

The app only adds pronunciation fixes automatically. **Any other tag you can type straight into your script**, for example:

- Cartesia: `Your code is <spell>A7X 92</spell>. <break time="1s"/> Got it?`
- ElevenLabs v3/v4: `[whispers] Don't tell anyone.`
- Deepgram: `2020 Acura "RX" 350`

Then check **What was sent** and any warnings to see how each provider handled it.

---

## 7. Samples (pre-recorded takes)

![Samples mode: pre-recorded takes of the Numbers and money preset from all five providers](images/samples.jpg)

**Samples** mode plays a recording of every test preset by every provider, at no cost. It's what visitors to a public copy of the app would use.

**To record samples** (spends credits once: about 1,700 characters per provider for all 8 presets):

1. Open a terminal in the app folder.
   *Windows:* open the folder in File Explorer, click the address bar, type `cmd`, press **Enter**.
2. Run:
   ```
   npm run build-demo
   ```
   Or record only some presets: `npm run build-demo -- numbers names`
3. Each line shows the preset, provider and first-audio time, or the error. The app can keep running meanwhile.
4. In the app, refresh and click **Samples**, then pick a preset.

**Options:**
- **Voices and models** used for samples are in the `lineup` list at the top of `scripts/build-demo.js`. For Cartesia, set `CARTESIA_DEMO_VOICE=<voice id>` in `.env`.
- **Include your pronunciation fixes:** Export from the Pronunciations panel, rename the file to `demo-lexicon.json`, put it in the app folder, then run build-demo.
- Clips are saved in `public/demo/clips/` and their details in `public/demo/manifest.json`. Running again replaces those presets' clips.

---

## Troubleshooting

**I changed `.env` and nothing happened.** The app reads `.env` only at startup. Close the server window, run `start.bat` (or `npm start`) again, then refresh the browser.

**A change still doesn't take effect.** Make sure only one server window is open. If an old one is still running, a new one can't start (the port is taken) and your browser keeps talking to the old one. Close them all, then start once.

**"This site can't be reached."** The server window was closed or hadn't finished starting. Start it and refresh.

**Claude: "This API key is not scoped to a workspace".** Some Anthropic keys work across several workspaces and must name one. Either create a key tied to a single workspace, or copy your workspace ID (starts with `wrkspc_`) from [Console → Settings → Workspaces](https://platform.claude.com/settings/workspaces) and add `ANTHROPIC_WORKSPACE_ID=wrkspc_…` to `.env`. Restart afterwards.

**A take shows a red error.** The message comes from the provider. Common causes: a typo in the key, no credit left, a model or voice your plan doesn't include, or text over the provider's limit (Deepgram Aura-2 accepts up to 2,000 characters).

**`'node' is not recognized`.** Node.js isn't installed or the terminal was opened before installing it. Install Node.js 20.12+ from [nodejs.org](https://nodejs.org), close all terminals, and try again.
