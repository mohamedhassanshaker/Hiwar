## Next.js full-stack project structure rules (short list)

1. Use the App Router — organize routes, layouts, pages, and API endpoints inside `src/app/`.
2. Separate by responsibility — keep UI components, business logic, database access, and validation in separate folders.
3. Keep routes thin — `page.tsx` and `route.ts` should orchestrate work, not contain complex business logic.
4. Use feature-based modules — group related code for users, products, orders, etc., when the project grows.
5. Server Components by default — add `"use client"` only when you need state, effects, event handlers, or browser APIs.
6. Keep secrets server-only — never expose database credentials, API keys, or private environment variables to client components.
7. Centralize database access — use a shared database client and repositories or query modules.
8. Validate all inputs — validate form data, API requests, query parameters, and environment variables.
9. Enforce authorization on the server — check permissions in every protected data-access or mutation path; hiding UI is not security.
10. Reuse shared code — put reusable UI in `components/`, helpers in `lib/`, and shared types in `types/`.
11. Use Server Actions appropriately — for mutations triggered by the UI; use Route Handlers for HTTP APIs and external integrations.
12. Handle errors consistently — use route-level error boundaries, meaningful messages, and structured server-side logging.
13. Keep naming consistent — use clear, predictable names and avoid giant files or overly generic utility folders.
14. Avoid premature abstraction — start simple and extract shared modules when repetition or complexity justifies it.
15. Test important logic — prioritize authentication, authorization, validation, business rules, and critical user flows.

## Recommended folder structure

text
```
src/
├── app/
│   ├── (auth)/
│   ├── (dashboard)/
│   ├── api/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── error.tsx
│   └── not-found.tsx
├── components/
│   ├── ui/
│   └── shared/
├── features/
│   ├── users/
│   │   ├── components/
│   │   ├── actions.ts
│   │   ├── service.ts
│   │   ├── repository.ts
│   │   ├── schema.ts
│   │   └── types.ts
├── lib/
│   ├── db.ts
│   ├── auth.ts
│   └── utils.ts
├── hooks/
└── types/
public/
```

- `app/` — routing, layouts, pages, and HTTP endpoints.
- `components/` — reusable UI shared across features.
- `features/` — feature-specific components and logic.
- `actions.ts` — Server Actions for mutations.
- `service.ts` — business rules and orchestration.
- `repository.ts` — database queries and persistence.
- `schema.ts` — input validation schemas.
- `lib/` — shared infrastructure and utilities.

This is a recommended convention, not a mandatory Next.js structure. See the official [project structure guide](<https:/nextjs.org/docs/app/getting-started/project-structure>) and [data security guide](<https:/nextjs.org/docs/app/guides/data-security>). Next.js

+1

Golden rule: Keep UI, business logic, data access, and validation separate. Start simple, then introduce feature folders as the project grows.