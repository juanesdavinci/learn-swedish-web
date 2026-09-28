# hej! Swedish learning

A small Swedish study app for steady, beginner-friendly practice. It uses Node.js and SQLite locally, with no third-party packages or account needed.

## Open the app

With Node.js 22.13 or newer installed, run `npm.cmd start` in PowerShell and open `http://127.0.0.1:4173`. On other shells, use `npm start`. The server listens on this computer only.

Run the automated server tests with `npm.cmd test` in PowerShell or `npm test` in other shells.

## What it does

- Study vocabulary and everyday phrases in separate sections.
- Review everyday phrases with a reveal-and-rate flashcard flow.
- Practice listening with spoken Swedish and comprehension choices.
- Review short grammar notes covering verbs, nouns, and word order.
- Keep a personal collection of short phrases from music, TV, podcasts, and online media. Starter lines are original examples, not quotations.
- Hear Swedish pronunciation through your browser's built-in speech synthesis, when available.
- Record study sessions and see daily minutes, reviewed cards, streaks, and a calendar summary.
- Add, search, and remove saved words and phrases.
- Open Swedish grammar, verb, dictionary, and vocabulary references based on the linked [language-learning resource list](https://github.com/tigertv/language-learning#swedish).

## Storage

The server stores words, everyday phrases, media phrases, settings, and study logs in `data/hej.sqlite`. Browser `localStorage` remains as a local fallback. The database is ignored by Git and does not sync between devices.

The first server launch imports any existing `hej!` data available to that browser origin. Since `file://` and `http://127.0.0.1:4173` have separate browser storage, export a JSON backup from the old page and use the import button after opening the server version to move existing data across. Backups include study progress and saved content.
