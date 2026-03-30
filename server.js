const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// ===== In-memory database =====
const cards = new Map();
const shareLinks = new Map();

// ===== Simple UUID =====
function uuid() { return crypto.randomUUID(); }
function shortId() { return crypto.randomUUID().slice(0, 8); }

// ===== Helpers =====
function parseBody(req, maxSize = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxSize) { reject(new Error('Body too large')); return; }
      body += chunk;
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); }
    });
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(data);
  });
}

function parseQuery(url) {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const params = {};
  url.slice(idx + 1).split('&').forEach(p => {
    const [k, v] = p.split('=');
    params[decodeURIComponent(k)] = decodeURIComponent(v || '');
  });
  return params;
}

function getPathname(url) {
  const idx = url.indexOf('?');
  return idx === -1 ? url : url.slice(0, idx);
}

// ===== Gemini Vision API =====
function callGemini(base64Image, mimeType) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      contents: [{
        parts: [
          {
            text: `ä½ æ¯åçè¾¨è­å°å®¶ãè«ä»ç´°åæéå¼µåçåçï¼ç²¾ç¢ºæåææè³è¨ã

è«ä»¥ JSON æ ¼å¼åå³ï¼æ¬ä½å¦ä¸ï¼å¦ææ¾ä¸å°ææ¬ä½å°±çç©ºå­ä¸²ï¼ï¼
{
  "name": "å§åï¼ä¸­ææè±æçå¯ï¼",
  "title": "è·ç¨±",
  "company": "å¬å¸åç¨±",
  "phone": "å¬å¸é»è©±ï¼å«åç¢¼ï¼",
  "mobile": "ææ©èç¢¼",
  "email": "Email",
  "website": "ç¶²ç«",
  "address": "å°å",
  "industry": "ç¢æ¥­åé¡ï¼å¾ä»¥ä¸é¸æï¼ç§ææ¥­ãéèæ¥­ãé«çæ¥­ãæè²æ¥­ãè£½é æ¥­ãæåæ¥­ãæ¿åºæ©éãõ¤é£²æ¥­ãé¶å®æ¥­ãå¶ä»ï¼",
  "notes": "å¶ä»å¨åçä¸çå°ä½æªæ­¸é¡çè³è¨",
  "rawText": "åçä¸ææå¯è¾¨è­çåå§æå­ï¼ä¿çæè¡ï¼"
}

éè¦ï¼
- åªåå³ JSONï¼ä¸è¦å ä»»ä½è§£éæ markdown æ¨è¨
- é»è©±èç¢¼è«ä¿çåå§æ ¼å¼
- å¦ææå¤åé»è©±ï¼ç¬¬ä¸åæ¾ phoneï¼ç¬¬äºåæ¾ mobile
- ç¢æ¥­åé¡è«æ ¹æå¬å¸åç¨±åè·ç¨±æºæ§å¤æ·`
          },
          {
            inlineData: {
              mimeType: mimeType || 'image/jpeg',
              data: base64Image
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048
      }
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.error) {
            reject(new Error(result.error.message || 'Gemini API error'));
            return;
          }
          const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
          // Extract JSON from response (handle possible markdown code blocks)
          let jsonStr = text;
          const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) jsonStr = jsonMatch[1];
          jsonStr = jsonStr.trim();

          try {
            const parsed = JSON.parse(jsonStr);
            resolve(parsed);
          } catch (parseErr) {
            // If JSON parse fails, return raw text
            resolve({ rawText: text, name: '', title: '', company: '', phone: '', mobile: '', email: '', website: '', address: '', industry: 'å¶ä»', notes: '' });
          }
        } catch (e) {
          reject(new Error('Failed to parse Gemini response'));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ===== Server =====
const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const pathname = getPathname(req.url);
  const query = parseQuery(req.url);
  const method = req.method;

  try {
    // ===== API Routes =====

    // POST /api/ocr - Gemini Vision OCR
    if (method === 'POST' && pathname === '/api/ocr') {
      if (!GEMINI_API_KEY) {
        return json(res, { success: false, message: 'Gemini API Key æªè¨­å®' }, 500);
      }
      const body = await parseBody(req);
      const { image, mimeType } = body;
      if (!image) {
        return json(res, { success: false, message: 'è«æä¾åçè³æ' }, 400);
      }
      // Remove data URL prefix if present
      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      const detectedMime = mimeType || (image.startsWith('data:') ? image.match(/^data:([^;]+)/)?.[1] : 'image/jpeg');

      const result = await callGemini(base64Data, detectedMime);
      return json(res, { success: true, data: result });
    }

    // GET /api/cards
    if (method === 'GET' && pathname === '/api/cards') {
      let result = Array.from(cards.values());
      if (query.search) {
        const s = query.search.toLowerCase();
        result = result.filter(c =>
          (c.name || '').toLowerCase().includes(s) ||
          (c.company || '').toLowerCase().includes(s) ||
          (c.title || '').toLowerCase().includes(s) ||
          (c.email || '').toLowerCase().includes(s) ||
          (c.phone || '').toLowerCase().includes(s)
        );
      }
      if (query.industry) {
        result = result.filter(c => c.industry === query.industry);
      }
      return json(res, { success: true, data: result });
    }

    // POST /api/cards
    if (method === 'POST' && pathname === '/api/cards') {
      const body = await parseBody(req);
      const id = uuid();
      const card = { id, ...body, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      cards.set(id, card);
      return json(res, { success: true, data: card });
    }

    // PUT /api/cards/:id
    if (method === 'PUT' && pathname.startsWith('/api/cards/')) {
      const id = pathname.split('/')[3];
      if (!cards.has(id)) return json(res, { success: false, message: 'åçä¸å­å¨' }, 404);
      const body = await parseBody(req);
      const updated = { ...cards.get(id), ...body, updatedAt: new Date().toISOString() };
      cards.set(id, updated);
      return json(res, { success: true, data: updated });
    }

    // DELETE /api/cards/:id
    if (method === 'DELETE' && pathname.startsWith('/api/cards/') && !pathname.includes('batch')) {
      const id = pathname.split('/')[3];
      if (!cards.has(id)) return json(res, { success: false, message: 'åçä¸å­å¨' }, 404);
      cards.delete(id);
      return json(res, { success: true, message: 'å·²åªé¤' });
    }

    // POST /api/cards/batch-delete
    if (method === 'POST' && pathname === '/api/cards/batch-delete') {
      const { ids } = await parseBody(req);
      if (!ids || !Array.isArray(ids)) return json(res, { success: false, message: 'è«æä¾ ids é£å' }, 400);
      ids.forEach(id => cards.delete(id));
      return json(res, { success: true, message: `å·²åªé¤ ${ids.length} ç­` });
    }

    // POST /api/share
    if (method === 'POST' && pathname === '/api/share') {
      const { cardIds, expiresInMinutes } = await parseBody(req);
      if (!cardIds || !Array.isArray(cardIds) || cardIds.length === 0) {
        return json(res, { success: false, message: 'è«é¸æè¦åäº«çåç' }, 400);
      }
      const shareId = shortId();
      const mins = expiresInMinutes || 60;
      const expiresAt = new Date(Date.now() + mins * 60 * 1000);
      shareLinks.set(shareId, {
        shareId, cardIds,
        expiresAt: expiresAt.toISOString(),
        createdAt: new Date().toISOString(),
        viewCount: 0, expiresInMinutes: mins
      });
      const host = req.headers.host || `localhost:${PORT}`;
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      return json(res, {
        success: true,
        data: {
          shareId,
          shareUrl: `${protocol}://${host}/share/${shareId}`,
          expiresAt: expiresAt.toISOString(),
          expiresInMinutes: mins
        }
      });
    }

    // GET /api/share/:shareId
    if (method === 'GET' && pathname.startsWith('/api/share/')) {
      const shareId = pathname.split('/')[3];
      const share = shareLinks.get(shareId);
      if (!share) return json(res, { success: false, message: 'åäº«é£çµä¸å­å¨' }, 404);
      if (new Date() > new Date(share.expiresAt)) {
        shareLinks.delete(shareId);
        return json(res, { success: false, message: 'åäº«é£çµå·²éæ' }, 410);
      }
      share.viewCount++;
      const sharedCards = share.cardIds
        .map(id => cards.get(id)).filter(Boolean)
        .map(({ id, name, company, title, phone, email, address, website, industry, notes }) =>
          ({ id, name, company, title, phone, email, address, website, industry, notes }));
      return json(res, {
        success: true,
        data: {
          cards: sharedCards, expiresAt: share.expiresAt,
          viewCount: share.viewCount,
          remainingSeconds: Math.max(0, Math.floor((new Date(share.expiresAt) - new Date()) / 1000))
        }
      });
    }

    // GET /api/shares
    if (method === 'GET' && pathname === '/api/shares') {
      const now = new Date();
      const allShares = Array.from(shareLinks.values()).map(s => ({
        ...s, isExpired: now > new Date(s.expiresAt),
        remainingSeconds: Math.max(0, Math.floor((new Date(s.expiresAt) - now) / 1000))
      }));
      return json(res, { success: true, data: allShares });
    }

    // DELETE /api/share/:shareId
    if (method === 'DELETE' && pathname.startsWith('/api/share/')) {
      const shareId = pathname.split('/')[3];
      shareLinks.delete(shareId);
      return json(res, { success: true, message: 'åäº«é£çµå·²éé' });
    }

    // POST /api/export
    if (method === 'POST' && pathname === '/api/export') {
      const { cardIds } = await parseBody(req);
      let exportCards;
      if (cardIds && Array.isArray(cardIds) && cardIds.length > 0) {
        exportCards = cardIds.map(id => cards.get(id)).filter(Boolean);
      } else {
        exportCards = Array.from(cards.values());
      }
      return json(res, { success: true, data: exportCards });
    }

    // GET /api/stats
    if (method === 'GET' && pathname === '/api/stats') {
      const allCards = Array.from(cards.values());
      const industryCount = {};
      allCards.forEach(c => {
        const ind = c.industry || 'æªåé¡';
        industryCount[ind] = (industryCount[ind] || 0) + 1;
      });
      return json(res, {
        success: true,
        data: {
          totalCards: allCards.length,
          industryBreakdown: industryCount,
          recentCards: allCards.slice(-5).reverse()
        }
      });
    }

    // ===== Share page route =====
    if (method === 'GET' && pathname.startsWith('/share/')) {
      return serveFile(res, path.join(__dirname, 'public', 'share.html'));
    }

    // ===== Static files =====
    if (method === 'GET') {
      const filePath = pathname === '/' ? '/index.html' : pathname;
      const fullPath = path.join(__dirname, 'public', filePath);
      if (!fullPath.startsWith(path.join(__dirname, 'public'))) {
        res.writeHead(403); return res.end('Forbidden');
      }
      return serveFile(res, fullPath);
    }

    json(res, { success: false, message: 'Not Found' }, 404);
  } catch (err) {
    console.error(err);
    json(res, { success: false, message: err.message }, 500);
  }
});

// ===== Cleanup expired share links every minute =====
setInterval(() => {
  const now = new Date();
  for (const [id, share] of shareLinks.entries()) {
    if (now > new Date(share.expiresAt)) shareLinks.delete(id);
  }
}, 60 * 1000);

server.listen(PORT, () => {
  console.log('');
  console.log('=================================');
  console.log('  åçç - æºè½åçææç®¡çç³»çµ±');
  console.log('=================================');
  console.log(`  æ¬å°ç¶²å: http://localhost:${PORT}`);
  console.log(`  Gemini AI: ${GEMINI_API_KEY ? 'â å·²åç¨' : 'â æªè¨­å® API Key'}`);
  console.log('  æºåå°±ç·ï¼éå§ææåçå§ï¼');
  console.log('=================================');
  console.log('');
});
