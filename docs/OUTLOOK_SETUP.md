# Outlook Calendar Integration Setup

## Overview

The scheduler can optionally integrate with Microsoft Outlook calendars to:

- **Detect conflicts** — When assigning a class, check the employee's Outlook calendar for busy/tentative/out-of-office time slots (uses the free/busy API, so event details are never accessed)
- **Sync events** — Automatically create Outlook calendar events when schedules are saved, and remove them when schedules are deleted

The integration is **opt-in**. When the required environment variables are not set, all Outlook features are silently disabled and the app works exactly as before.

## Prerequisites

- An **Azure AD (Entra ID) tenant** with admin access
- **Exchange Online** licenses for employees whose calendars you want to check/sync
- Employee **email addresses** populated in the app (employees without email are skipped)

## Step 1: Register an Azure AD Application

1. Go to the [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** (or **Microsoft Entra ID**) > **App registrations** > **New registration**
3. Fill in:
   - **Name**: e.g. `Iowa Center Scheduler`
   - **Supported account types**: "Accounts in this organizational directory only" (single tenant)
   - **Redirect URI**: Leave blank (not needed for client credentials flow)
4. Click **Register**
5. On the app's overview page, note:
   - **Application (client) ID** — this is your `AZURE_CLIENT_ID`
   - **Directory (tenant) ID** — this is your `AZURE_TENANT_ID`

## Step 2: Add API Permissions

1. In your app registration, go to **API permissions** > **Add a permission**
2. Select **Microsoft Graph** > **Application permissions**
3. Search for and add: **`Calendars.ReadWrite`**
4. Click **Grant admin consent for [your organization]**
5. Confirm the status shows a green checkmark

This single permission allows the app to check free/busy status and create/delete calendar events. No other permissions are needed.

## Step 3: Create a Client Secret

1. Go to **Certificates & secrets** > **Client secrets** > **New client secret**
2. Add a description (e.g. `Scheduler production`) and choose an expiration period
3. Click **Add**
4. **Immediately copy the Value** (not the Secret ID) — this is your `AZURE_CLIENT_SECRET`

> **Important**: The secret value is only shown once. If you lose it, you'll need to create a new one. Set a calendar reminder to rotate the secret before it expires.

## Step 4: (Recommended) Restrict Mailbox Access

By default, the `Calendars.ReadWrite` application permission grants access to **all mailboxes** in the organization. To limit the app to only employee mailboxes:

1. Create a **mail-enabled security group** in Azure AD containing your employee mailboxes
2. Run the following in **Exchange Online PowerShell**:

```powershell
New-ApplicationAccessPolicy `
  -AppId "<your AZURE_CLIENT_ID>" `
  -PolicyScopeGroupId "<security-group-email>" `
  -AccessRight RestrictAccess `
  -Description "Limit scheduler to employee mailboxes only"
```

3. Verify the policy:

```powershell
Test-ApplicationAccessPolicy `
  -AppId "<your AZURE_CLIENT_ID>" `
  -Identity "<employee-email>"
```

This should return `AccessRight: Granted` for employees in the group and `Denied` for others.

## Step 5: Set Environment Variables

Add these three environment variables to your deployment environment (e.g. Railway, Docker, or `.env` file):

| Variable | Value | Example |
|----------|-------|---------|
| `AZURE_TENANT_ID` | Directory (tenant) ID from Step 1 | `a1b2c3d4-e5f6-7890-abcd-ef1234567890` |
| `AZURE_CLIENT_ID` | Application (client) ID from Step 1 | `12345678-abcd-ef01-2345-6789abcdef01` |
| `AZURE_CLIENT_SECRET` | Client secret value from Step 3 | `xYz~abc123...` |

Restart the backend after setting the variables. The app automatically detects the credentials and enables Outlook features.

## Step 6: Verify the Integration

1. **Check that it's enabled**: Call `GET /system/config` — the response should include `"outlook_enabled": true`

2. **Test conflict detection**: Create a schedule that overlaps with an existing Outlook calendar event for an employee. The schedule form should show an Outlook conflict warning.

3. **Test event creation**: Save a new schedule. Within a few seconds, a calendar event should appear in the employee's Outlook calendar with the class name, location, and time.

4. **Test event deletion**: Delete the schedule. The corresponding Outlook calendar event should be removed.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `outlook_enabled` is `false` | One or more env vars missing/empty | Verify all three `AZURE_*` vars are set and restart |
| Token acquisition errors in logs | Invalid credentials or missing admin consent | Re-check client ID/secret; ensure admin consent was granted |
| No conflicts detected | Employee has no email in the app | Add email to the employee record |
| Events not appearing in Outlook | ARQ worker not running, or Redis not connected | Check worker logs and Redis connectivity |
| `403 Forbidden` from Graph API | Application Access Policy blocking | Add the employee's mailbox to the security group |

All Outlook errors are logged under the `outlook` logger. **Core scheduling always works regardless of Outlook errors** — the integration is designed to fail gracefully.
