// Netlify Function: scan-form
// Receives a base64 photo of the paper intake form, calls the Anthropic API
// server-side (so the API key never touches the browser), and returns the
// extracted fields as JSON.
//
// Set the ANTHROPIC_API_KEY environment variable in your Netlify site
// settings (Site configuration -> Environment variables) before deploying.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server is missing ANTHROPIC_API_KEY. Set it in Netlify site settings.' })
    };
  }

  let base64, mediaType;
  try {
    ({ base64, mediaType } = JSON.parse(event.body));
    if (!base64 || !mediaType) throw new Error('Missing image data');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bad request: ' + err.message }) };
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  const prompt = `You are reading a handwritten bike-rental intake form from a photo. Extract the following fields and respond with ONLY a raw JSON object, no markdown fences, no commentary.

Fields:
- name (string or null)
- nationality (string or null)
- passport (string or null, passport/ID number)
- contactMethod (one of "WhatsApp","Messenger","Phone","Line","other", or null — best guess based on what's written)
- contactOther (string or null — the raw contact detail if contactMethod is "other", e.g. an email or a method not in the list; also include the actual phone number/handle here even if contactMethod matches one of the listed methods, so nothing is lost)
- bikeModel (string or null)
- rentingDateFrom (string, "YYYY-MM-DD", or null — the rental start date. If only day/month is legible, infer the year using ${todayStr} as "today")
- returnDate (string, "YYYY-MM-DD", or null — the rental end/return date, same inference rules)
- returnTime (string, "HH:MM" 24-hour, or null)
- deliverToHotel ("Yes","No", or null)
- totalPrice (number or null, digits only)
- paidBy (one of "cash","scan","wise","revolut", or null)
- otherNotes (string or null — any other handwritten info on the form that doesn't fit the fields above, e.g. a room number, a second phone, a note)

If a field is illegible or absent, use null. Do not guess wildly — only fill what you can reasonably read.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return { statusCode: response.status, body: JSON.stringify({ error: data.error?.message || 'Anthropic API error' }) };
    }

    const textBlock = (data.content || []).map((b) => b.text || '').join('');
    const cleaned = textBlock.replace(/```json|```/g, '').trim();
    const fields = JSON.parse(cleaned);

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};