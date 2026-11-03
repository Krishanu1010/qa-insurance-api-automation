# Sample local execution

This record captures an actual local verification run for this project. It is not a benchmark and does not claim results for an external insurer system.

| Item | Observed result |
|---|---|
| OS | Windows |
| Node.js | v24.22.1 |
| pnpm | 11.25.0 |
| Frozen dependency installation | Passed |
| TypeScript check | Passed |
| Playwright API suite | 14 passed, 0 failed |
| Test duration | 5.2 seconds |
| Allure report generation | Passed |
| Target | Included local API with SQLite WASM persistence |

Commands used:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm allure:generate
```

The generated HTML and Allure reports live in ignored output directories. Rerun the commands to produce evidence for the current checkout. The CI workflow also uploads reports and failure traces as run artifacts.
