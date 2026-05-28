---
"flowershow": patch
---

Drop the legacy ESLint configuration that isn't wired into any script. Biome (`biome.json`) is the project's source of truth for formatting and linting. Removes `.eslintrc`, `.eslintignore`, and the `@typescript-eslint/eslint-plugin` + `@typescript-eslint/parser` devDependencies.
