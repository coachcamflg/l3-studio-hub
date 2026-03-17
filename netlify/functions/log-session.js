const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const LOCATION_ID = 'Wse81cCAXA6GfvKE3Wwc';
const CAM_CONTACT_ID = 'fWKdewTMHyA43pb3CBIz';

async function ghlFetch(path, options = {}) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
      'Version': GHL_VERSION,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL ${res.status}: ${text}`);
  }
  return res.json();
}

async function searchContact(clientName) {
  try {
    const data = await ghlFetch(`/contacts/?locationId=${LOCATION_ID}&query=${encodeURIComponent(clientName)}&limit=1`);
    return data.contacts?.[0] || null;
  } catch {
    return null;
  }
}

async function createNote(contactId, body) {
  return ghlFetch(`/contacts/${contactId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

function buildNoteHtml(session) {
  const skippedLabel = session.items_skipped > 0
    ? `<span style="color:#ef4444;font-weight:bold;">${session.items_skipped} items skipped</span>`
    : '<span style="color:#22c55e;font-weight:bold;">All items completed</span>';

  return `
<h3>${session.session_type || 'Studio'} Session Checklist — ${session.completion_rate}</h3>
<table style="border-collapse:collapse;width:100%;">
  <tr><td style="padding:4px 8px;font-weight:bold;">Type</td><td style="padding:4px 8px;">${session.session_type || 'In-Studio'}</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Producer</td><td style="padding:4px 8px;">${session.producer}</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Client</td><td style="padding:4px 8px;">${session.client}</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Cameras</td><td style="padding:4px 8px;">${session.cameras}</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Guests</td><td style="padding:4px 8px;">${session.guests}</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Checked</td><td style="padding:4px 8px;">${session.items_checked} / ${session.total_items}</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Status</td><td style="padding:4px 8px;">${skippedLabel}</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Duration</td><td style="padding:4px 8px;">${session.duration_minutes} min</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Timestamp</td><td style="padding:4px 8px;">${new Date(session.timestamp).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}</td></tr>
</table>
<p style="margin-top:8px;font-size:12px;color:#888;">Logged by L3 Studio Hub</p>
  `.trim();
}

export async function handler(event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = JSON.parse(event.body);
    const noteHtml = buildNoteHtml(session);
    const results = { camNote: false, clientNote: false, clientFound: null };

    // 1. Always log a note on Cam's contact (operations tracking)
    try {
      await createNote(CAM_CONTACT_ID, noteHtml);
      results.camNote = true;
    } catch (err) {
      console.error('Failed to create note on Cam:', err.message);
    }

    // 2. Log note on client contact — use contactId if provided, fall back to name search
    if (session.contactId) {
      try {
        await createNote(session.contactId, noteHtml);
        results.clientNote = true;
        results.clientFound = session.client;
      } catch (err) {
        console.error('Failed to create note on client:', err.message);
      }
    } else if (session.client) {
      const contact = await searchContact(session.client);
      if (contact) {
        results.clientFound = contact.contactName;
        try {
          await createNote(contact.id, noteHtml);
          results.clientNote = true;
        } catch (err) {
          console.error('Failed to create note on client:', err.message);
        }
      }
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, ...results }),
    };
  } catch (err) {
    console.error('log-session error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
}
