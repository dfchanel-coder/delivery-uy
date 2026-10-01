# Phase Execution Template

When implementing a roadmap phase:

## 1. Read

Read:

AGENTS.md
PROJECT_STATE.md
ROADMAP.md
ARCHITECTURE.md
DATABASE.md
SECURITY.md

and relevant ADRs.

---

## 2. Inspect

Inspect current repository implementation.

Do not assume documented modules already exist.

---

## 3. Plan

Provide a concise implementation plan.

Identify:

files to create
files to modify
database changes
API changes
security implications
tests

---

## 4. Implement

Implement production-quality code.

Avoid placeholders.

---

## 5. Verify

Run:

lint
typecheck
tests
build where appropriate

---

## 6. Database

If schema changed:

generate migration
validate migration
verify database constraints

---

## 7. Documentation

Update relevant docs.

---

## 8. Project State

Update PROJECT_STATE.md.

---

## 9. Completion Report

Report:

implemented
tests
files changed
remaining risks
next logical task