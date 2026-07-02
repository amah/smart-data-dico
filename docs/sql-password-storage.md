# Saving DB passwords for the SQL Run feature

When you run a generated `sql` block against a package's database, the **SQL Run**
dialog asks for connection details. The non-secret parts (dialect, host, port,
database) are prefilled from the package's `physical.yaml`; the **password** is
handled separately and, by default, kept only **in memory** for the session.

You can optionally tick **“Remember password on this machine”** to persist it.

## Security model

A DB password is a *personal, per-machine* secret, so it is **never** written into
the project tree (`physical.yaml` is git-tracked/shared and would leak it). Saved
passwords live under `~/.dico-app/` — the same 0600 area used for Jira/Confluence
tokens — keyed per **(package, connection identity, user)**, never logged, and
redacted from every API response.

An **auto-detecting provider chain** picks the strongest at-rest protection
available on the machine, in order:

| # | Provider | Available when | Protection |
|---|----------|----------------|------------|
| 1 | **Electron `safeStorage`** | running inside the desktop app | OS keychain / DPAPI / libsecret — key held by the OS |
| 2 | **OS keyring** (`keytar`) | the optional native module is installed and a keyring exists | OS-managed key |
| 3 | **AES-256-GCM file** | `DICO_SECRET_KEY` env var is set | key derived (scrypt) from your master key, which is **never** stored beside the ciphertext |
| — | **Refuse** | none of the above | the checkbox is disabled — no plaintext fallback, no false assurance |

If nothing secure is available, the UI shows *“unavailable here”* and passwords are
**not** persisted. The in-memory session cache still works as before.

## Enabling persistence on a server / headless install

- **Recommended:** install the OS keyring binding so provider #2 is used:
  ```bash
  npm install keytar    # optional native dependency, loaded lazily
  ```
- **Or** provide a master key for AES-GCM envelope encryption (provider #3):
  ```bash
  export DICO_SECRET_KEY="<a long, high-entropy secret from your secrets manager>"
  ```
  Keep `DICO_SECRET_KEY` out of the repo and out of shell history; source it from a
  KMS/Vault or a protected env file. Rotating it invalidates previously saved
  passwords (they simply fail to decrypt and you re-enter them once).

### Environment variables

| Variable | Purpose |
|----------|---------|
| `DICO_SECRET_KEY` | Master key that enables the AES-GCM provider (if no OS keyring). |
| `DICO_SECRET_PROVIDER` | Force a provider: `safeStorage` \| `keytar` \| `aesgcm` \| `none` \| `auto` (default `auto`). |
| `DICO_SECRETS_FILE` | Override the secrets file location (default `~/.dico-app/secrets.json`). |

## Forgetting a password

Use **“Forget saved password”** in the SQL Run dialog (clears all saved passwords
for that package), or `DELETE /api/sql/secret/:packageName`. Persisting/forgetting
requires ADMIN or EDITOR; the stored account should be a **read-only** DB user, in
keeping with the read-only SELECT guard the feature enforces.
