import { supabase } from './supabase'

export type AppointmentWorkflowStatus =
  | 'scheduled'
  | 'booked'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'open'

export type WorkflowAppointment = {
  id: string
  patient_id: string | null
  provider_id: string | null
  appointment_date: string
  appointment_time: string
  duration_minutes: number
  appointment_type: string
  status: AppointmentWorkflowStatus
  reason: string | null
  notes: string | null
  outlook_event_id: string | null
  checked_in_at: string | null
  handed_over_at: string | null
  clinical_updated_at: string | null
  treatment_completed_at: string | null
}

export type TreatmentCompletionResult = {
  appointment_id: string
  appointment_status: AppointmentWorkflowStatus
  invoice_id: string
  invoice_number: string
  invoice_status: string
  total: number
  amount_paid: number
  balance: number
  treatment_count: number
}

export type PaymentResult = {
  invoice_id: string
  invoice_number: string
  status: string
  amount_paid: number
  balance: number
  applied_amount?: number
  appointment_id: string | null
  appointment_completed: boolean
}

export type ProviderDirectoryEntry = {
  id: string
  full_name: string
  role: 'dentist' | 'admin'
}

export type VisitHistoryTreatment = {
  id: string
  procedure_name: string
  tooth_number: number | null
  cost: number
  status: string
  notes: string | null
}

export type VisitHistoryClinicalNote = {
  id: string
  visit_type: string
  subjective: string | null
  objective: string | null
  assessment: string | null
  plan: string | null
  note_date: string
}

export type VisitHistoryInvoiceItem = {
  id: string
  treatment_id: string | null
  description: string
  quantity: number
  unit_price: number
  total: number
}

export type VisitHistoryInvoice = {
  id: string
  invoice_number: string
  invoice_date: string
  total: number
  amount_paid: number
  balance: number
  status: string
  items: VisitHistoryInvoiceItem[]
}

export type PatientVisitHistory = {
  appointment_id: string
  appointment_date: string
  appointment_time: string
  appointment_type: string
  appointment_status: AppointmentWorkflowStatus
  reason: string | null
  notes: string | null
  provider_id: string | null
  provider_name: string | null
  treatments: VisitHistoryTreatment[]
  clinical_notes: VisitHistoryClinicalNote[]
  invoice: VisitHistoryInvoice | null
}

function client() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

export async function checkInAppointment(appointmentId: string) {
  const { data, error } = await client().rpc('check_in_appointment', { p_appointment_id: appointmentId })
  if (error) throw new Error(error.message)
  return data as WorkflowAppointment
}

export async function handoverAppointmentToDentist(appointmentId: string) {
  const { data, error } = await client().rpc('handover_appointment_to_dentist', { p_appointment_id: appointmentId })
  if (error) throw new Error(error.message)
  return data as WorkflowAppointment
}

export async function deleteAppointment(appointmentId: string) {
  const { data, error } = await client().rpc('delete_appointment', {
    p_appointment_id: appointmentId,
  })
  if (error) throw new Error(error.message)
  return data as {
    appointment_id: string
    deleted: boolean
    outlook_event_id: string | null
  }
}

export async function completeTreatmentWorkflow(appointmentId: string) {
  const { data, error } = await client().rpc('complete_treatment_workflow', { p_appointment_id: appointmentId })
  if (error) throw new Error(error.message)
  return data as TreatmentCompletionResult
}

export async function recordInvoicePayment(invoiceId: string, amount: number, paymentMethod?: string) {
  const { data, error } = await client().rpc('record_invoice_payment', {
    p_invoice_id: invoiceId,
    p_amount: amount,
    p_payment_method: paymentMethod?.trim() || null,
  })
  if (error) throw new Error(error.message)
  return data as PaymentResult
}

export async function listActiveProviders() {
  const { data, error } = await client()
    .from('active_provider_directory')
    .select('id, full_name, role')
    .order('full_name')
  if (error) throw new Error(error.message)
  return (data ?? []) as ProviderDirectoryEntry[]
}

export async function getPatientVisitHistory(patientId: string) {
  const { data, error } = await client().rpc('get_patient_visit_history', { p_patient_id: patientId })
  if (error) throw new Error(error.message)
  return (data ?? []) as PatientVisitHistory[]
}
