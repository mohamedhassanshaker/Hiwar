---
title: Glossary
status: draft
owner: product owner
version: 0.1
last-updated: 2026-11-19
related: [specs/README.md]
---

# Glossary

| Term | Meaning |
| --- | --- |
| Organization | A customer of Hiwar; the tenant |
| Agent | An AI assistant with a persona, knowledge, tools, guardrails and escalation rules; edited as a draft and published as numbered versions |
| Deployment | One agent installed on one website, with its own public key, allowed origins, appearance and quotas |
| AI conversation | A conversation in which the AI replied at least once; the billing unit |
| Owner (of a conversation) | The AI or the one person who may reply to the visitor; changes increase the ownership version |
| Ownership version | A counter on each conversation, increased on every ownership change; replies sent with an old version are refused |
| Take over, claim, hand back, release | Ownership changes defined in INB-002 |
| Write tool | A tool that changes something outside Hiwar; it runs only after visitor confirmation or staff approval unless set to run automatically |
| Source | A knowledge file, website or FAQ entry, prepared into chunks |
| Support access | Time-limited, read-only access to a customer's control panel that the customer grants to Hiwar support |
