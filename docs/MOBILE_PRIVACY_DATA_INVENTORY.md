# Mobile Privacy / Data Safety Engineering Inventory

This is an engineering inventory for Dallmayr's privacy/legal owner and Google Play Data Safety completion. It is **not** a substitute for an approved privacy policy or legal advice.

## Product scope

`DallmayrERP Field` is an authenticated internal business application for technicians and road technicians. The Android field bundle communicates with the existing DallmayrERP Supabase backend and can temporarily retain operational data on the device so field work survives connectivity loss.

## Data handled by the Android field client

| Data | Purpose | Device retention | Backend destination |
| --- | --- | --- | --- |
| Work email | Authentication/account identification | Saved as part of the authenticated session/profile cache | Supabase Auth / DallmayrERP |
| Password | Authentication | **Not stored by the field client** | Sent directly to Supabase Auth |
| Access/refresh tokens | Maintain authenticated session | Local WebView application storage | Supabase Auth |
| Staff name, role, branch | Display identity and enforce field-client scope | Cached for up to 24 hours of offline authorization | DallmayrERP users/user_details |
| Assigned service job details | Field execution | Cached per user for offline work | DallmayrERP service_jobs |
| Customer/site name and address | Navigate/identify service location | Included in cached assigned jobs | DallmayrERP customer/site records |
| Machine identifiers | Verify the physical machine | Included in cached assigned jobs | DallmayrERP machines |
| Scanned barcode/QR text | Machine verification | Stored only with a queued closure when submitted | `complete_assigned_service_job` |
| Closure outcome and notes | Service completion evidence | Offline outbox until successful sync | DallmayrERP closure/audit workflow |
| Closure photo | Optional service evidence | IndexedDB outbox until successful sync | Supabase Storage `dallmayrerp-task-photos` |
| Sync error/conflict state | Prevent silent data loss | Offline outbox until resolved | Normally device-only |

## Device capabilities

- Camera: live QR/barcode scanning and optional evidence-photo capture.
- User-selected photo/file access: scan an existing barcode image or select evidence.
- Internet: authentication, job refresh, photo upload and closure synchronization.

The Android manifest intentionally does not request broad photo-library access.

## Offline behavior and retention

- A successful online authorization may be reused offline for no more than 24 hours.
- Assigned field jobs are cached in the local app sandbox for the current business user.
- A closure is written to IndexedDB **before** a network submission is attempted.
- Optional closure photos can therefore remain on the device while a record is pending.
- Sign-out is blocked while pending closures remain so unsynced evidence is not accidentally orphaned.
- When the outbox is empty, sign-out clears the cached field-job queue and saved profile/session state.
- Successful closure synchronization deletes the queued closure/photo blob from the outbox.
- A server-side assignment/status conflict is retained as Needs review instead of silently deleted.

## Security controls relevant to disclosure

- Production assets are locally packaged; the native client does not execute a hosted application shell by default.
- Content Security Policy restricts scripts to packaged assets and network connections to Supabase HTTPS origins.
- Android application backups are disabled.
- Upload keystores and runtime configuration output are excluded from source control.
- The app's offline cache does not replace server authorization. Every online read/sync remains subject to the existing Supabase session, RLS and controlled RPCs.
- The field client does not intentionally include advertising or analytics SDKs.

## Privacy-policy / Play review items for Dallmayr

The privacy owner should confirm and disclose, as applicable:

1. Dallmayr legal entity/controller identity and contact information.
2. Business purpose and lawful basis for processing employee, customer/site and service evidence data.
3. Supabase/backend hosting and any other processors/subprocessors used in production.
4. Retention periods for server-side service records, audit events and uploaded evidence photos.
5. Employee/device-management expectations for lost, shared or replaced field devices.
6. Data-subject/employee rights and internal contact/escalation process.
7. Whether the application is distributed publicly, privately/managed, or only through internal testing.
8. Google Play Data Safety answers based on the final production build and all included SDKs.

Re-run this inventory if analytics, crash reporting, push notifications, location, contacts, Bluetooth or any additional SDK/capability is introduced.
