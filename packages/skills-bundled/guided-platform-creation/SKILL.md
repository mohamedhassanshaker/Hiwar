---
name: guided-platform-creation
description: Create or configure a platform object (request type, project, agent, etc.) by discovering required fields from your tool grant and asking step-by-step with live data.
allowed-tools: project_list, project_get, role_list, org_unit_list, person_list, request_type_create, request_type_edit, request_type_attribute_create, request_type_step_create, agent_create, agent_edit, skill_create, knowledge_collection_create
---

# Guided platform object creation

You are creating or configuring a platform object: a request type, project, agent, skill, knowledge collection, or other resource.

Your approach is **discovery-driven**, not question-driven. The platform is the source of truth. You never guess what exists or what fields are available.

## Pattern: Parse, fetch, ask, create

### 1. Parse your tool grant

Look at the tools you have access to. Group them by pattern:
- `<subject>_list` → fetch live options for that subject
- `<subject>_create` → create a new instance
- `<subject>_edit` → modify an existing one
- `<subject>_get` → fetch details

For example, creating a request type means you have:
- `project_list` → fetch projects
- `role_list` → fetch approval roles
- `org_unit_list` → fetch org structure (if needed for scoping)
- `request_type_create` → create the type
- `request_type_attribute_create` → add attributes
- `request_type_step_create` → add workflow steps

### 2. Fetch live data first

Call the `_list` tools to populate your choices. Never assume what projects exist, what roles can approve, or what fields are valid.

Example:
```
Call project_list() 
  → returns: [Project A (budget: 50k), Project B (budget: 100k), Project C (budget: 75k)]

Call role_list()
  → returns: [Admin, Approver, Finance Lead, Operations Lead]

Call org_unit_list()
  → returns: [Engineering, Finance, Operations, HR]
```

### 3. Ask step-by-step, one question at a time

**Show real options from the platform, as choices the person clicks.** Ask with `ask_person`,
never by listing the options in your reply.

- A choice between what step 2 found: `ask_person` with `question: "Which project should this
  belong to?"` and `options: ["Project A", "Project B", "Project C"]`.
- Several values at once (a name in each language, a code, an SLA): `ask_person` with `fields`,
  one per value, each with a `label` and, where you can propose one, a `default`. The person
  fills in a form instead of typing everything on one line.
- Free text with nothing to propose: `ask_person` with the question alone.

### 4. Detect required fields from the creation tool

Before asking for every field, check what the creation tool requires. Read its schema.

For `request_type_create`, required fields typically include:
- `code` (short identifier)
- `name_en` (English name)
- `name_ar` (Arabic name)
- `project_id` (from step 2)

Optional fields might include:
- `description`
- `category`
- `approval_role_id` (from step 2)
- `sla_minutes`

Ask only required fields first. Offer optional fields after, grouped by purpose (Workflow, Approval, Details).

### 5. Confirm, then create

Before calling the creation tool, show the user what you are about to create:

```
Ready to create:
- Code: MERCH-RESET
- Name (EN): Merchant credentials reset
- Name (AR): إعادة تعيين بيانات اعتماد التاجر
- Project: Finance (ID: proj_123)
- Approval role: Finance Lead (ID: role_456)
- SLA: 24 hours
```

Ask for the go-ahead with `ask_person` and `options: ["Create it", "Change something"]`.

Once confirmed, call the tool and show the result.

### 6. Add sub-resources if needed

If creating a request type with attributes or workflow steps:

- Call `request_type_attribute_create` for each attribute (e.g., merchant_id)
- Call `request_type_step_create` for each workflow step
- Confirm each addition

### 7. Never assume

- **No guessing names.** If you need a project name, call `project_list` and show the user what exists.
- **No hardcoded lists.** If you need roles, call `role_list`. If you need org units, call `org_unit_list`.
- **No skipping required fields.** If the creation tool requires a field, ask the user. The schema is the authority.
- **No inventing validation.** If you do not know whether a value is valid, ask the tool. It will refuse if it rejects the value.

## Example: Create MERCH-RESET request type

**User says:** "Create a request type to allow users to request merchant credentials reset."

**You do:**

1. Parse tools → I have `project_list`, `role_list`, `request_type_create`, `request_type_attribute_create`
2. Call `project_list()` → shows 3 projects
3. `ask_person`: "Which project?", `options: ["Finance", "Operations", "IT"]`
   - User clicks "Finance"
4. Call `role_list()` → shows 5 roles
5. `ask_person`: "Which role approves?", `options: ["Admin", "Finance Lead", "Director", "Processor"]`
   - User clicks "Finance Lead"
6. `ask_person`: "The request type's details", `fields`: `code` (default `MERCH-RESET`),
   `name_en` (default "Merchant credentials reset"), `name_ar` (default
   "إعادة تعيين بيانات اعتماد التاجر"), `extra_attribute` (default "merchant ID")
   - User checks the form and submits it
7. `ask_person` with the summary and `options: ["Create it", "Change something"]`
8. Call `request_type_create()` with code, names, project, role
9. Call `request_type_attribute_create()` to add the merchant_id attribute

## When to ask vs. when to fetch

- **Fetch when:** the platform has a fixed set of options (projects, roles, org units)
- **Ask when:** the user provides custom data (names, descriptions, codes)
- **Detect when:** a creation tool requires specific fields — the schema is the source of truth

## Language and tone

- Ask in the language the user is writing in
- Keep questions short and specific: "Which project?" not "What project would you like this to belong to, if any?"
- Offer choices on a new line, each clearly readable
- Confirm the whole object before creating it
