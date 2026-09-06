-- ============================================================================
-- PART 6: Outlook Calendar Integration Schema
-- Adds calendar sync tracking columns to the appointments table
-- ============================================================================

-- Add Outlook calendar event tracking to appointments
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS outlook_event_id VARCHAR(512),
ADD COLUMN IF NOT EXISTS outlook_calendar_account VARCHAR(255);

-- Index for quick lookup of synced appointments
CREATE INDEX IF NOT EXISTS idx_appointments_outlook_event
ON appointments(outlook_event_id)
WHERE outlook_event_id IS NOT NULL;

-- Comments
COMMENT ON COLUMN appointments.outlook_event_id IS 'Microsoft Graph calendar event ID, set when synced to Outlook';
COMMENT ON COLUMN appointments.outlook_calendar_account IS 'Entra account (email/UPN) used to create the Outlook calendar event';
