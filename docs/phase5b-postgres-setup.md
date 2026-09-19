# Phase 5B local PostgreSQL setup

This repository uses a workspace-local PostgreSQL 18.6 instance for Phase 5B development and integration tests. The Windows x86-64 binary archive is the EDB build linked from PostgreSQL's official Windows download page. No Windows service or global installation is created.

## Paths and connection details

- Binary root: `tmp/postgres-18.6/pgsql/pgsql`
- Data directory: `tmp/postgres-18.6/data`
- Server log: `tmp/postgres-18.6/postgres.log`
- Address: `127.0.0.1:55432` (IPv4 loopback only)
- Development database: `conan_tcg_dev`
- Test database: `conan_tcg_test`
- Database user: `postgres`
- `DATABASE_URL=postgresql://postgres@127.0.0.1:55432/conan_tcg_dev`
- `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/conan_tcg_test`

The isolated fixture uses PostgreSQL `trust` authentication for local and loopback connections. It has no password and must remain bound to `127.0.0.1`; do not use it for production, shared hosts, or sensitive data.

## Control commands

Run from the repository root:

```powershell
.\scripts\postgres-dev.ps1 start
.\scripts\postgres-dev.ps1 status
.\scripts\postgres-dev.ps1 stop
```

`start` initializes the data directory only when it does not yet contain a PostgreSQL cluster, starts the server in a hidden background process, and creates both databases if missing. It refuses to initialize a non-empty unknown data directory. Re-running `start` is safe and idempotent. PostgreSQL writes stderr to the workspace-local `postgres.log` and stdout to `postgres-stdout.log`.

Because the EDB Windows binaries cannot initialize a cluster through this repository's non-ASCII path, the controller maps the workspace-local PostgreSQL directory to the ASCII drive alias `P:` while PostgreSQL runs. It refuses to replace an existing `P:` mapping. The data remains physically stored in `tmp/postgres-18.6/data`; no junction, service, or external data directory is created. `stop` removes the drive alias after the server exits.

The optional `-Port` argument can select another port, but callers must use the same port for subsequent `status` commands and connection URLs. A running cluster retains the port chosen at start.

## Binary provenance

- PostgreSQL Windows downloads: <https://www.postgresql.org/download/windows/>
- EDB binary archives: <https://www.enterprisedb.com/download-postgresql-binaries>
- Archive URL: <https://get.enterprisedb.com/postgresql/postgresql-18.6-1-windows-x64-binaries.zip>
- Downloaded archive size: `343808005` bytes
- Downloaded archive SHA-256: `FBE23DA234EE31547BF8A36D29DFD81E82B849DF2D2B78D2EECB43D360252F8C`

The checksum above records the exact downloaded artifact for reproducibility; it is not presented as a vendor-published signature.
