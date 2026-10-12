# LLM Providers

FocusLoop runs locally by default. Open **Settings → Models** from the sidebar, or use its model
status shortcut, to configure DeepSeek, OpenAI, or a custom **OpenAI-compatible** endpoint. This first version implements Chat
Completions and SSE, not the Responses API, Anthropic/Gemini native protocols, or subscription login.

## Configure a model

1. Select a preset, or **Add provider** and enter its name and API Base URL.
2. Enter an API Key. For example, `https://example.com/v1` is a base URL; do not append
   `/chat/completions`. An address with no path is normalized to `/v1`; gateway prefixes are preserved.
3. Click **Fetch models**. This explicitly calls the endpoint's `/models` API. It does not save a key,
   enable a model, or transmit learner material.
4. The searchable model picker opens after fetching. Choose a model to fill the same **Model ID**
   input; it stays editable. Its display name is filled under **Advanced options**, where you can
   change it, configure compatibility, or manage additional models. Fetching alone never replaces
   your current ID. If discovery is unsupported, enter any `model_id` manually; the list is not an
   allowlist. Up to 32 models can be configured per provider, with at most 512 discovered models.
5. **Save only** stores configuration without enabling a new model. A blank Key keeps the saved
   credential only for the same endpoint. Optionally **Test connection** after saving.
6. **Save & use** saves any edits and enables the model shown in the Model ID input. It makes no
   test request and does not discard a successful verification if the configuration is unchanged.

Saving is not connection verification. Testing sends only `Reply with OK.` with a bounded token
limit, may incur a small API charge, and never falls back to Mock or enables the model. Verification
is per model and per app run; editing configuration or credentials invalidates it.

**Use local only** retains configurations and keys but disables remote model calls. Deleting an
active provider or removing its only credential also switches back to local execution.

Home, Focus Session and Dashboard remain in the app sidebar, which starts folded and can be
recalled with the logo button. Settings opens a centered native modal, not a navigation route.
Its **General** section contains language, appearance, original-material preference and local data
controls. **Models** contains the provider editor, with a horizontal provider switcher and an
independently scrolling form. The model picker stays anchored to its input during scrolling.
Closing settings leaves the underlying screen unchanged and returns focus to its opener.

Settings rail, preference-row and appearance-card styles are adapted from
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) under the
[MIT license](licenses/deepseek-harness-MIT.txt), also included with packaged applications.

## Compatibility and credentials

- For models that require `max_completion_tokens`, choose it under **Advanced options**.
  You can cap output and turn off unsupported `temperature` or `seed` parameters.
- Provider instances have independent IDs and credentials, even when their endpoints use the same
  protocol. Ordinary metadata and the active `{ providerConfigId, modelId }` pair are stored in SQLite.
- Keys are separately encrypted by Electron `safeStorage`, never stored in SQLite or returned by
  configuration queries. Insecure Linux `basic_text` storage is refused.
- Credentials are scoped to the exact normalized URL. Changing it never reuses the previous Key,
  and network requests refuse redirects. HTTPS is required except for loopback HTTP endpoints.
- `FOCUSLOOP_DEEPSEEK_API_KEY` and `FOCUSLOOP_OPENAI_API_KEY` override saved credentials only for
  their respective preset endpoints. Editing an endpoint cannot forward its environment Key to
  another host. Setting one of these variables opts into that preset on a fresh profile; an explicitly
  saved local-only choice still wins. Unset the variable and restart to stop using that environment Key.
- The old single-key configuration is intentionally discarded, not migrated.
- **Delete everything** removes learner data, provider configuration and app-owned encrypted Key
  files, and resets model selection to local. Files that could not be removed are reported. Environment
  credentials cannot be deleted by the application.

## Tests without cloud dependencies

Normal unit tests mock HTTP. Electron E2E tests use temporary profiles and dynamically allocated
loopback ports, not remote services, fixed ports, developer paths, or repository `.env` values.
Secure-storage integration needs an available OS keychain.

Live API checks are **opt-in** and separate from `pnpm test` / CI. Credentials can be injected by a
cloud runner or loaded from an explicitly specified env file:

```sh
# DeepSeek: DEEPSEEK_API_KEY (or FOCUSLOOP_DEEPSEEK_API_KEY)
node scripts/test-llm-connection.mjs --provider deepseek

# Any compatible provider: OPENAI_COMPATA_BASE_URL and OPENAI_COMPATA_API_KEY
node scripts/test-llm-connection.mjs --provider compatible --model YOUR_MODEL_ID

# Local development only: explicitly load an ignored env file
node scripts/test-llm-connection.mjs --env-file .env --provider compatible --model YOUR_MODEL_ID

# Discovery only: no completion calls or inference charges
node scripts/test-llm-connection.mjs --provider compatible --model YOUR_MODEL_ID --list-only
```

`OPENAI_COMPATA_MODEL` can replace `--model`. `DEEPSEEK_BASE_URL` and `DEEPSEEK_MODEL` optionally
customize the DeepSeek smoke test. There are no provider-specific variables for custom vendors and
no fixed custom model IDs in the script. Output excludes keys, URLs, response bodies and raw exceptions.
