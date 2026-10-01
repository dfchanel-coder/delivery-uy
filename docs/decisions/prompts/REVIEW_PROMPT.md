# Repository Review Prompt

Review the current DeliveryUY repository as a senior software architect,
security engineer and QA engineer.

Read first:

AGENTS.md
PROJECT_STATE.md
ARCHITECTURE.md
DATABASE.md
SECURITY.md
LEGAL.md
ROADMAP.md

Then inspect implementation.

Look specifically for:

architecture violations
duplicate logic
security vulnerabilities
authentication issues
authorization / IDOR risks
incorrect order transitions
financial precision problems
race conditions
missing database constraints
missing transactions
unsafe payment flows
unsafe delivery verification
GPS privacy problems
missing indexes
N+1 database queries
hardcoded configuration
missing tests
outdated documentation
unfinished placeholders

Do not modify anything initially.

Produce findings grouped by:

CRITICAL
HIGH
MEDIUM
LOW
IMPROVEMENTS

For every finding provide:

file
problem
impact
recommended correction

Then wait for instruction before large architectural changes.