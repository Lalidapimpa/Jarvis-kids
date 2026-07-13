/* Jarvis Jr. — the brain.
 *
 * Big idea: the ANIMAL talks, not a narrator. The animal is played by Claude,
 * but Claude is only allowed to say what is on the FACT SHEET the app sends.
 * That gives us both things Lalida asked for:
 *    - never repetitive  (Claude writes fresh words every single turn)
 *    - never wrong       (facts + the touch/safety rule are locked to the card)
 *
 * Env var required (already set in Netlify): ANTHROPIC_API_KEY
 */

const MODEL = 'claude-haiku-4-5-20251001';

const TOUCH_RULE = {
  no: {
    th: 'ห้ามจับเด็ดขาด. ถ้าเด็กถามเรื่องจับ/แตะ/เล่นด้วย ต้องบอกชัดว่าห้ามจับ และบอกเหตุผลสั้นๆ อย่างใจดี ไม่ขู่',
    en: 'MUST NOT be touched. If the child talks about touching, holding or grabbing you, say clearly that they must not touch you, and give the short kind reason. Never soften this.'
  },
  careful: {
    th: 'จับได้ แต่ต้องมีผู้ใหญ่อยู่ด้วยและต้องระวัง. ถ้าเด็กถามเรื่องจับ ให้บอกว่าจับได้แต่ต้องให้ผู้ใหญ่ช่วย และบอกสิ่งที่ต้องระวัง',
    en: 'MAY be touched only gently and only with a grown-up helping. If the child talks about touching you, say a grown-up must help, and name the thing to watch out for.'
  },
  ok: {
    th: 'จับได้อย่างปลอดภัย. บอกเด็กได้ว่าจับได้เบาๆ นะ แต่ต้องอ่อนโยน',
    en: 'CAN be safely held. Tell the child they may hold you gently, and to be kind.'
  }
};

function factSheet(a, lang) {
  const f = (a.facts && a.facts[lang]) || {};
  const lines = [];
  if (f.look) lines.push('- What I look like: ' + f.look);
  if (f.home) lines.push('- Where I live: ' + f.home);
  if (f.food) lines.push('- What I eat: ' + f.food);
  if (f.life) lines.push('- How I live: ' + f.life);
  if (f.care) lines.push('- Safety / what to watch out for: ' + f.care);
  if (f.fun && f.fun.length) lines.push('- Fun things about me: ' + f.fun.join(' | '));
  return lines.join('\n');
}

function buildSystem(body) {
  const lang = body.lang === 'en' ? 'en' : 'th';
  const language = lang === 'th' ? 'Thai' : 'English';
  const a = body.animal || null;
  const kids = Array.isArray(body.kids) ? body.kids.filter(Boolean) : [];
  const kidLine = kids.length
    ? 'The child (or children) you are talking to are called: ' + kids.join(', ') + '. Use a name now and then, not every line.'
    : 'You do not know the child\'s name.';

  // No animal on stage -> Jarvis the little robot friend is speaking.
  if (!a) {
    return [
      'You are Jarvis, a warm little robot friend for a child aged 2-5.',
      kidLine,
      'Reply in ' + language + '. ONE short, happy sentence (max 12 words). Then invite them to pick an animal.',
      'Never repeat a sentence you have already said in this conversation.',
      'Never scary. Never violent. Never mention that you are an AI or a computer program.'
    ].join('\n');
  }

  const touch = TOUCH_RULE[a.touch] || TOUCH_RULE.no;
  const name = lang === 'th' ? (a.th || a.en) : (a.en || a.th);

  return [
    'ROLEPLAY: You ARE a real ' + (a.en || name) + '. You are alive, in front of a child aged 2-5, and you are talking to them yourself.',
    'Speak in the FIRST PERSON as the animal ("I am...", "I live in..."). You are NOT a narrator and NOT a robot.',
    kidLine,
    '',
    'HOW TO REPLY (obey every line):',
    '1. Reply in ' + language + ' only.',
    '2. ONE short sentence about yourself (max 14 words), THEN ONE simple question back to the child (max 8 words).',
    '3. NEVER repeat any sentence, fact or question you already used in this conversation. Bring something new each time. This is the most important rule after safety: a child who hears the same line twice gets bored.',
    '4. Warm, playful, curious, like a friend. Words a 2-5 year old knows.',
    '5. If the child answers your question, react to their answer warmly first, then share something new.',
    '',
    'TRUTH RULE: You may ONLY use what is on your FACT SHEET below. Never invent facts, numbers or places.',
    'If the child asks something that is not on the sheet, cheerfully say you are not sure, and share something from the sheet instead.',
    '',
    'SAFETY RULE (never soften, never break): ' + touch[lang],
    'Never frighten the child. No blood, no hunting scenes, no death, no teeth-and-attack talk. You are gentle.',
    '',
    'YOUR FACT SHEET (' + name + '):',
    factSheet(a, lang)
  ].join('\n');
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) };
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY is not set in Netlify' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'bad json' }) }; }

  const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  if (!messages.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'no messages' }) };
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 160,        // one sentence + one question, Thai needs room
        temperature: 1,         // variety: this is what stops it sounding like a robot
        system: buildSystem(body),
        messages: messages
      })
    });

    const data = await r.json();

    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || ('status ' + r.status);
      return { statusCode: 502, body: JSON.stringify({ error: msg }) };
    }

    let text = '';
    if (data && Array.isArray(data.content)) {
      text = data.content.filter(function (b) { return b.type === 'text'; })
                         .map(function (b) { return b.text; })
                         .join(' ')
                         .trim();
    }
    if (!text) {
      return { statusCode: 502, body: JSON.stringify({ error: 'empty reply' }) };
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: text })
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};
