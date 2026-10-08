# Release Notes

Date: 2026-03-17
Release: Billing App Quality Verification and Workflow Stability Update

## Overview

This release focused on validating the full billing workflow and resolving issues affecting payment accuracy, proforma handling, and user setup flow.

The goal of this release was to ensure the system is stable, accurate, and ready for day-to-day business use across the most important workflows.

## What Was Verified

The following areas were fully tested:

- Login and authentication
- Owner onboarding and setup
- Dashboard access and navigation
- Customer management
- Sales Invoice workflow
- Purchase Bill workflow
- Sales Proforma workflow
- Convert Proforma to Invoice flow
- Payment In workflow
- Payment Out workflow
- Reports and export features
- Backup and restore
- Settings update and save
- Major screen loading and smoke coverage
- Validation and edge-case handling

## Bugs Fixed

### 1. Proforma paid amount displayed too early

Previously, a confirmed receipt could appear as paid before it had actually been applied. This caused the balance shown on the proforma list to be lower than it should be.

This has been fixed so that only applied payments affect the paid and balance values.

### 2. Converted proformas could show the wrong balance

Previously, when a proforma was converted into an invoice, the related payment history could stop appearing correctly on the proforma list. This could make a paid proforma appear unpaid again.

This has been fixed so that converted proformas continue to reflect the correct paid and outstanding amounts.

### 3. Owner setup could end without a selectable company

In one setup path, a newly created owner could complete setup and still be taken to a company selection screen that showed no company.

This has been fixed so the first company is created and retained correctly through setup.

### 4. Proforma history edit and conversion path failed for local records

Some locally created proformas could not be reopened from history for editing or conversion.

This has been fixed so those proformas now open correctly and can be converted without losing data.

## Improvements Included

- Improved stability of the owner setup flow
- Improved reliability of proforma reopening and conversion
- Improved financial accuracy in proforma paid and balance calculations
- Improved consistency of payment allocation behavior after conversion
- Expanded automated test coverage for critical business workflows

## Test Summary

Final verification results:

- Playwright end-to-end tests: `12/12 passed`
- Existing automated regression/logic tests: `6/6 passed`
- Production build: `passed`

## Production Readiness

This release has passed end-to-end testing, regression checks, and production build verification.

Core workflows have been validated successfully, including invoicing, proformas, payments, reporting, backup, and settings.

## Final Confirmation

This release is considered:

- Stable
- Functionally verified
- Financially validated in the tested workflows
- Ready for production use
