import { supabase } from './supabase'

type InvoiceEmail = {
  invoiceNumber: string
  patientName: string
  total: string
  balance: string
  invoiceDate: string
  recipient: string
  notes?: string
}

type CalendarAppointment = {
  patientName: string
  provider: string
  type: string
  date: string
  time: string
  durationMinutes: number
  notes?: string
}

async function getProviderToken() {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data } = await supabase.auth.getSession()
  if (!data.session?.provider_token) throw new Error('Microsoft calendar access is not available. Sign in again and grant Calendars.ReadWrite permission.')
  return data.session.provider_token
}

export async function createCalendarEvent(appointment: CalendarAppointment) {
  const token = await getProviderToken()
  const start = new Date(`${appointment.date}T${to24HourTime(appointment.time)}:00`)
  const end = new Date(start.getTime() + appointment.durationMinutes * 60_000)
  const response = await fetch('https://graph.microsoft.com/v1.0/me/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: `${appointment.type} - ${appointment.patientName}`,
      body: { contentType: 'text', content: `Patient: ${appointment.patientName}\nProvider: ${appointment.provider}\n${appointment.notes ?? ''}` },
      start: { dateTime: start.toISOString(), timeZone: 'UTC' },
      end: { dateTime: end.toISOString(), timeZone: 'UTC' },
      showAs: 'busy',
    }),
  })
  if (!response.ok) throw new Error(`Outlook calendar could not create the event (${response.status}).`)
  return response.json() as Promise<{ id: string; webLink?: string }>
}

function to24HourTime(time: string) {
  const [clock, meridiem] = time.split(' ')
  let [hours, minutes] = clock.split(':').map(Number)
  if (meridiem === 'PM' && hours !== 12) hours += 12
  if (meridiem === 'AM' && hours === 12) hours = 0
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export async function sendInvoiceEmail(invoice: InvoiceEmail) {
  if (!supabase) throw new Error('Supabase is not configured.')

  const { data: sessionData } = await supabase.auth.getSession()
  const providerToken = sessionData.session?.provider_token
  if (!providerToken) {
    throw new Error('Microsoft email access is not available. Sign in again and grant Mail.Send permission.')
  }

  const message = {
    message: {
      subject: `Invoice ${invoice.invoiceNumber} from Sponty Dental Services`,
      body: {
        contentType: 'HTML',
        content: `<p>Hello,</p><p>Your invoice <strong>${invoice.invoiceNumber}</strong> is available.</p><p><strong>Patient:</strong> ${invoice.patientName}<br><strong>Invoice date:</strong> ${invoice.invoiceDate}<br><strong>Total:</strong> ${invoice.total}<br><strong>Balance due:</strong> ${invoice.balance}</p>${invoice.notes ? `<p>${invoice.notes}</p>` : ''}<p>Please contact the practice if you have any questions.</p>`,
      },
      toRecipients: [{ emailAddress: { address: invoice.recipient } }],
    },
    saveToSentItems: true,
  }

  const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${providerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Outlook could not send the invoice email (${response.status}). ${detail}`)
  }
}

export type WaitlistBroadcast = {
  recipients: string[]
  slotId: string
  patientId: string
  claimToken: string
  appUrl: string
  appointmentType: string
  appointmentDate: string
  appointmentTime: string
  durationMinutes: number
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character] ?? character)
}

export async function sendWaitlistBroadcastEmail(broadcast: WaitlistBroadcast) {
  if (!supabase) throw new Error('Supabase is not configured.')
  if (!broadcast.recipients.length) throw new Error('At least one waitlist recipient is required.')

  const { data: sessionData } = await supabase.auth.getSession()
  const providerToken = sessionData.session?.provider_token
  if (!providerToken) throw new Error('Microsoft email access is not available. Sign in again and grant Mail.Send permission.')

  const claimUrl = new URL('/claim-slot', broadcast.appUrl)
  claimUrl.searchParams.set('slot_id', broadcast.slotId)
  claimUrl.searchParams.set('patient_id', broadcast.patientId)
  claimUrl.searchParams.set('token', broadcast.claimToken)
  const safeUrl = escapeHtml(claimUrl.toString())
  const safeType = escapeHtml(broadcast.appointmentType)
  const safeDate = escapeHtml(broadcast.appointmentDate)
  const safeTime = escapeHtml(broadcast.appointmentTime)

  const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: { Authorization: `Bearer ${providerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: `Appointment opening: ${broadcast.appointmentType}`,
        body: {
          contentType: 'HTML',
          content: `<p>An appointment has opened for <strong>${safeType}</strong> on ${safeDate} at ${safeTime}.</p><p><a href="${safeUrl}" style="display:inline-block;padding:10px 16px;background:#0078d4;color:#ffffff;text-decoration:none;border:2px solid #005a9e;">Claim appointment</a></p><p>This link expires when the waitlist claim window closes or another patient claims the slot.</p>`,
        },
        toRecipients: broadcast.recipients.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    }),
  })
  if (!response.ok) throw new Error(`Outlook could not send the waitlist email (${response.status}). ${await response.text()}`)
}

export type BookedWaitlistAppointment = {
  id: string
  patientName: string
  appointmentType: string
  appointmentDate: string
  appointmentTime: string
  durationMinutes: number
  outlookEventId?: string | null
}

export async function syncBookedWaitlistCalendarEvent(appointment: BookedWaitlistAppointment) {
  const token = await getProviderToken()
  const start = new Date(`${appointment.appointmentDate}T${to24HourTime(appointment.appointmentTime)}:00`)
  const end = new Date(start.getTime() + appointment.durationMinutes * 60_000)
  const event = {
    subject: `${appointment.appointmentType} - ${appointment.patientName}`,
    body: { contentType: 'text', content: `Patient: ${appointment.patientName}\nBooked from waitlist.` },
    start: { dateTime: start.toISOString(), timeZone: 'UTC' },
    end: { dateTime: end.toISOString(), timeZone: 'UTC' },
    showAs: 'busy',
  }
  const endpoint = appointment.outlookEventId
    ? `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(appointment.outlookEventId)}`
    : 'https://graph.microsoft.com/v1.0/me/events'
  const response = await fetch(endpoint, {
    method: appointment.outlookEventId ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
  if (!response.ok) throw new Error(`Outlook could not sync the booked appointment (${response.status}).`)
  if (response.status === 204) return { id: appointment.outlookEventId ?? appointment.id }
  return response.json() as Promise<{ id: string; webLink?: string }>
}
