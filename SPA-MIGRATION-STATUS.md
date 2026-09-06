# Sponty-DMS — SPA Migration Status & Fix Guide

**Generated:** Session 3 (updated)  
**Project path:** `/home/nonbios/Sponty-DMS-main (2)`

---

## Architecture Overview

The app is a Single-Page Application rooted at `index.html`. The shell (`app.js`) handles routing via `navigate` custom events, stores context in `window.appContext = { page, id, mode }`, and uses `fetchAndRenderPage()` to inject child HTML into `#contentArea` and dynamically import the child module's `init()`.

---

## 1. Completed Work

### 1.1 SPA Core (`js/app.js`)
| Change | Detail |
|--------|--------|
| Content extraction | `fetchAndRenderPage()` strips shell layout from fetched HTML via known container selectors |
| Cache-busting imports | `modulePath + '?t=' + Date.now()` ensures controller re-runs on revisit |
| `window.appContext` | Set by `loadPage(page, id)` before every page load; child modules read context from it |
| Global utilities | `escapeHtml`, `showNotification`, `showLoading`, `hideLoading`, `calculateAge` exposed on `window.*` |
| Route map | `dashboard`, `patients`, `patient-add`, `patient-view`, `patient-edit`, `appointments`, `dental-records`, `dental-chart`, `treatments`, `billing`, `reports`, `users`, `settings` |

### 1.2 Patient List (`js/patients.js`)
| Change | Detail |
|--------|--------|
| Exported `init()` | Replaces DOMContentLoaded; called by dynamic import |
| `window.patientManager` | Exposed for console/debug access |
| `toggleFilters()` | Changed from `classList.toggle('hidden')` to `style.display` toggle (matches inline `display:none` in HTML) |
| `confirmDelete()` modal | Changed from `classList` to `style.display = 'flex'/'none'` (matches inline `display:none` in HTML) |
| `patients.html` IDs | Aligned with `patients.js` selectors (search, filters, table body, delete-modal) |

### 1.3 Patient Form (`js/patient-form.js`) — Fully Migrated ✅
| Change | Detail |
|--------|--------|
| Exported `init()` | Reads `window.appContext.mode` (`add`/`edit`) and `window.appContext.id` |
| Edit mode ID source | `window.appContext?.id` instead of `URLSearchParams` |
| After-save redirect | `navigate` event → `patient-view` with new/edited patient ID |
| Cancel button | `navigate` event → `patients` |
| View button (edit form) | `navigate` event → `patient-view` |
| Patient-not-found | `navigate` event → `patients` (delayed) |
| Syntax validated | `node --check` passed |

### 1.4 Patient Detail (`js/patient-view.js`) — Partially Migrated 🔄
| Change | Detail | Status |
|--------|--------|--------|
| Exported `init()` | Replaces DOMContentLoaded at bottom of file | ✅ |
| ID source | `window.appContext?.id` instead of `URLSearchParams` | ✅ |
| Missing-ID redirect | SPA `navigate` → `patients` | ✅ |
| Not-found redirect (line 69) | SPA `navigate` → `patients` | ✅ |
| Edit button (was line 410) | SPA `navigate` → `patient-form` with ID | ✅ |
| Back button | Still `window.location.href = 'patients.html'` | ❌ Pending |
| Clinical Notes link | Still `window.location.href = 'clinical-notes.html?patient_id=...'` | ❌ Pending |
| Medical History link | Still `window.location.href = 'medical-history.html?patient_id=...'` | ❌ Pending |
| Dental Chart link | Still `window.location.href = 'dental-chart.html?patient_id=...'` | ❌ Pending |
| Appointments link | Still `window.location.href = 'appointments.html?patient_id=...'` | ❌ Pending |

### 1.5 Shared Utility (`js/utils.js`)
| Change | Detail |
|--------|--------|
| `escapeHtml(str)` added | Encodes `& < > " '` to HTML entities; exported and exposed globally |

---

## 2. Remaining `patient-view.js` Edits (5 redirects)

These are all inside event listeners. Each needs one line replaced.

| Current Line | Current Code | Fix |
|---|---|---|
| ~424 | `window.location.href = 'patients.html'` | `document.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'patients' } }))` |
| ~433 | `window.location.href = 'clinical-notes.html?patient_id=...'` | `document.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'dental-records', id: this.patientId } }))` |
| ~441 | `window.location.href = 'medical-history.html?patient_id=...'` | Need route. See Section 3.1 |
| ~449 | `window.location.href = 'dental-chart.html?patient_id=...'` | `document.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'dental-chart', id: this.patientId } }))` |
| ~457 | `window.location.href = 'appointments.html?patient_id=...'` | `document.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'appointments', id: this.patientId } }))` |

---

## 3. Modules Not Yet SPA-Migrated

Each module below still uses `DOMContentLoaded`, `URLSearchParams`, and `window.location.href`. They all need the same pattern of changes applied to `patient-form.js` and `patient-view.js`.

### 3.1 `clinical-notes.js`
- **Lines 13-14:** `URLSearchParams` → `window.appContext?.id`
- **Line 18:** Redirect to `patients.html` → SPA navigate
- **Line 25:** Login redirect → keep as-is (auth redirects are intentional full-page)
- **Line 307:** Back to `patient-view.html` → SPA navigate with patient ID
- **Line 540:** `DOMContentLoaded` → export `init()`

### 3.2 `medical-history.js`
- **Lines 15-16:** `URLSearchParams` → `window.appContext?.id`
- **Line 20:** Redirect to `patients.html` → SPA navigate
- **Line 27:** Login redirect → keep as-is
- **Line 330:** Back to `patient-view.html` → SPA navigate with patient ID
- **Line 734:** `DOMContentLoaded` → export `init()`
- **Route needed in `app.js`:** `'medical-history'` case mapping to `medical-history.html` / `./medical-history.js`

### 3.3 `dental-chart.js`
- **Lines 44-45:** `URLSearchParams` → `window.appContext?.id`
- **Line 49:** Redirect to `patients.html` → SPA navigate
- **Line 56:** Login redirect → keep as-is
- **Line 290:** Back to `patient-view.html` → SPA navigate with patient ID
- **Line 606:** `DOMContentLoaded` → export `init()`

### 3.4 `appointments.js`
- **Line 455:** Add appointment → SPA navigate
- **Line 459:** View appointment → SPA navigate
- **Line 463:** Edit appointment → SPA navigate
- Needs export `init()`

### 3.5 `appointment-form.js` — Fully Migrated ✅
- Has `export function init()` for SPA loading
- After-save redirect uses SPA `navigate` event → `appointments`
- Outlook Calendar integration wired in (see Section 8)

### 3.6 `appointment-view.js`
- **Line 60:** Not-found redirect → SPA navigate to `appointments`
- **Lines 218, 222:** Edit redirects → SPA navigate to appointment-form with ID
- **Line 226:** View patient → SPA navigate to `patient-view` with ID
- Needs export `init()`

---

## 4. Missing Routes in `app.js`

The `loadPage()` switch needs cases for:

| Route Name | HTML File | JS Module | Needed By |
|---|---|---|---|
| `medical-history` | `medical-history.html` | `./medical-history.js` | patient-view sub-nav |
| `appointment-add` | `appointment-form.html` | `./appointment-form.js` | appointments list |
| `appointment-view` | `appointment-view.html` | `./appointment-view.js` | appointments list |
| `appointment-edit` | `appointment-form.html` | `./appointment-form.js` | appointment view/list |

Note: `patient-form` is used for both add (`mode:'add'`) and edit (`mode:'edit'`), serving as a pattern for `appointment-form`.

---

## 5. Global Pattern: Auth Redirects

All `window.location.href = 'login.html'` redirects should **remain as full-page navigation**. These are intentional — they exit the SPA when authentication fails. Found in:
- `auth.js` (lines 23, 41, 152)
- `clinical-notes.js` (line 25)
- `medical-history.js` (line 27)
- `dental-chart.js` (line 56)
- `entra-auth.js` (lines 337, 462)

---

## 6. HTML Display Mismatch Pattern

Several HTML templates use inline `style="display:none"` on elements that JS toggles via `classList.toggle('hidden')`. When found, the JS must be updated to use `element.style.display` instead. Already fixed for:
- `patients.html` / `patients.js` — filter panel and delete modal

**Check needed for:** All other HTML/JS module pairs (clinical-notes, medical-history, dental-chart, appointments).

---

## 7. Recommended Execution Order

1. **Finish `patient-view.js`** — 5 remaining redirects (current task)
2. **Add missing routes** to `app.js` — `medical-history`, `appointment-add`, `appointment-view`, `appointment-edit`
3. **Migrate `clinical-notes.js`** — export init, appContext, SPA nav
4. **Migrate `medical-history.js`** — export init, appContext, SPA nav
5. **Migrate `dental-chart.js`** — export init, appContext, SPA nav
6. **Migrate `appointments.js`** — export init, SPA nav
7. **Migrate `appointment-form.js`** — export init, appContext, SPA nav
8. **Migrate `appointment-view.js`** — export init, appContext, SPA nav
9. **Audit HTML display mismatches** across all modules
10. **End-to-end SPA navigation test** — full patient workflow cycle

---

## 8. Outlook Calendar Integration ✅

Allows users to create Outlook calendar events from appointments using a connected Entra (Azure AD) account.

### 8.1 Schema Migration
| File | Detail |
|------|--------|
| `part6-outlook-calendar-schema.sql` | Adds `outlook_event_id` (text) and `outlook_calendar_account` (text) columns to `appointments`, with index on `outlook_event_id` |

### 8.2 New Module: `js/outlook-calendar.js`
| Export | Purpose |
|--------|---------|
| `getEntraAccounts()` | Returns all MSAL accounts available for calendar sync |
| `getCalendarToken(account)` | Acquires `Calendars.ReadWrite` token (silent → popup fallback) |
| `createCalendarEvent(token, data, patientName)` | POSTs event to Microsoft Graph `/me/events` |
| `buildEventPayload(data, patientName)` | Converts appointment fields to Graph event JSON |
| `setMsalInstance(instance)` | Stores MSAL instance on `window.__msalInstance` |

### 8.3 Changes to Existing Files
| File | Change |
|------|--------|
| `js/entra-auth.js` | Exposes initialized MSAL instance as `window.__msalInstance` |
| `appointment-form.html` | Added hidden Outlook Calendar fieldset with sync checkbox, Entra account selector, and status area |
| `js/appointment-form.js` | Added `initOutlookSync()` method — shows fieldset when MSAL accounts exist, populates dropdown, shows sync status for already-synced appointments |
| `js/appointment-form.js` | Added `syncToOutlook()` method — acquires token, creates Graph event, persists `outlook_event_id` and `outlook_calendar_account` to DB |
| `js/appointment-form.js` | `init()` calls `initOutlookSync()` (non-blocking) |
| `js/appointment-form.js` | `handleSubmit()` calls `syncToOutlook()` after successful save; insert now returns ID via `.select('id').single()` |

### 8.4 User Flow
1. If MSAL is initialized and has accounts, the "Outlook Calendar" fieldset appears on the appointment form
2. User checks "Create Outlook calendar event" and selects an Entra-connected account
3. On save, the app acquires a `Calendars.ReadWrite` token (with interactive consent popup if needed)
4. A Graph API event is created with appointment type, patient name, date/time, duration, and notes
5. The event ID and account are persisted on the appointment record
6. Editing an already-synced appointment shows the sync status

---

## 9. Quick Reference: SPA Navigation Pattern

```javascript
// Navigate to a list page
document.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'patients' } }));

// Navigate to a detail/form page with an ID
document.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'patient-view', id: patientId } }));

// Read context in child module init()
const patientId = window.appContext?.id;
const mode = window.appContext?.mode; // 'add' or 'edit' for form pages
```

---

*Document auto-generated during SPA migration session. Update as modules are completed.*
