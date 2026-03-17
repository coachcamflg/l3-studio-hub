const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const LOCATION_ID = 'Wse81cCAXA6GfvKE3Wwc';

async function ghlFetch(path) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    headers: {
      'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
      'Version': GHL_VERSION,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL ${res.status}: ${text}`);
  }
  return res.json();
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } };
  }

  try {
    const params = event.queryStringParameters || {};
    const query = params.q || '';
    const tagged = params.tagged || '';

    // When filtering by tag, fetch more since we filter client-side
    const limit = tagged && !query ? 100 : 20;
    let url = `/contacts/?locationId=${LOCATION_ID}&limit=${limit}`;

    if (query) {
      url += `&query=${encodeURIComponent(query)}`;
    }

    const data = await ghlFetch(url);
    let contacts = (data.contacts || []).map(c => ({
      id: c.id,
      name: [c.firstNameRaw, c.lastNameRaw].filter(Boolean).join(' ') || c.contactName || 'Unknown',
      email: c.email || null,
      phone: c.phone || null,
      photo: c.profilePhoto || null,
      tags: c.tags || [],
      company: c.companyName || null,
    }));

    // If tagged filter requested, filter client-side
    if (tagged) {
      contacts = contacts.filter(c => c.tags.includes(tagged));
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts }),
    };
  } catch (err) {
    console.error('search-contacts error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts: [], error: err.message }),
    };
  }
}
