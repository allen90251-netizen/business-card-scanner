const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

// ===== In-memory database =====
const cards = new Map();
const shareLinks = new Map();

// ===== Simple UUID =====
function uuid() { return crypto.randomUUID(); }
function shortId() { return crypto.randomUUID().slice(0, 8); }

// ===== Helpers =====
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
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
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
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
      if (!cards.has(id)) return json(res, { success: false, message: '名片不存在' }, 404);
      const body = await parseBody(req);
      const updated = { ...cards.get(id), ...body, updatedAt: new Date().toISOString() };
      cards.set(id, updated);
      return json(res, { success: true, data: updated });
    }

    // DELETE /api/cards/:id
    if (method === 'DELETE' && pathname.startsWith('/api/cards/') && !pathname.includes('batch')) {
      const id = pathname.split('/')[3];
      if (!cards.has(id)) return json(res, { success: false, message: '名片不存在' }, 404);
      cards.delete(id);
      return json(res, { success: true, message: '已刪除' });
    }

    // POST /api/cards/batch-delete
    if (method === 'POST' && pathname === '/api/cards/batch-delete') {
      const { ids } = await parseBody(req);
      if (!ids || !Array.isArray(ids)) return json(res, { success: false, message: '請提供 ids 陣列' }, 400);
      ids.forEach(id => cards.delete(id));
      return json(res, { success: true, message: `已刪除 ${ids.length} 筆` });
    }

    // POST /api/share
    if (method === 'POST' && pathname === '/api/share') {
      const { cardIds, expiresInMinutes } = await parseBody(req);
      if (!cardIds || !Array.isArray(cardIds) || cardIds.length === 0) {
        return json(res, { success: false, message: '請選擇要分享的名片' }, 400);
      }
      const shareId = shortId();
      const mins = expiresInMinutes || 60;
      const expiresAt = new Date(Date.now() + mins * 60 * 1000);
      shareLinks.set(shareId, {
        shareId, cardIds,
        expiresAt: expiresAt.toISOString(),
        createdAt: new Date().toISOString(),
        viewCount: 0,
        expiresInMinutes: mins
      });
      const host = req.headers.host || `localhost:${PORT}`;
      return json(res, {
        success: true,
        data: {
          shareId,
          shareUrl: `http://${host}/share/${shareId}`,
          expiresAt: expiresAt.toISOString(),
          expiresInMinutes: mins
        }
      });
    }

    // GET /api/share/:shareId
    if (method === 'GET' && pathname.startsWith('/api/share/')) {
      const shareId = pathname.split('/')[3];
      const share = shareLinks.get(shareId);
      if (!share) return json(res, { success: false, message: '分享連結不存在' }, 404);
      if (new Date() > new Date(share.expiresAt)) {
        shareLinks.delete(shareId);
        return json(res, { success: false, message: '分享連結已過期' }, 410);
      }
      share.viewCount++;
      const sharedCards = share.cardIds
        .map(id => cards.get(id))
        .filter(Boolean)
        .map(({ id, name, company, title, phone, email, address, website, industry, notes }) =>
          ({ id, name, company, title, phone, email, address, website, industry, notes }));
      return json(res, {
        success: true,
        data: {
          cards: sharedCards,
          expiresAt: share.expiresAt,
          viewCount: share.viewCount,
          remainingSeconds: Math.max(0, Math.floor((new Date(share.expiresAt) - new Date()) / 1000))
        }
      });
    }

    // GET /api/shares
    if (method === 'GET' && pathname === '/api/shares') {
      const now = new Date();
      const allShares = Array.from(shareLinks.values()).map(s => ({
        ...s,
        isExpired: now > new Date(s.expiresAt),
        remainingSeconds: Math.max(0, Math.floor((new Date(s.expiresAt) - now) / 1000))
      }));
      return json(res, { success: true, data: allShares });
    }

    // DELETE /api/share/:shareId
    if (method === 'DELETE' && pathname.startsWith('/api/share/')) {
      const shareId = pathname.split('/')[3];
      shareLinks.delete(shareId);
      return json(res, { success: true, message: '分享連結已關閉' });
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
        const ind = c.industry || '未分類';
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
      // Prevent directory traversal
      if (!fullPath.startsWith(path.join(__dirname, 'public'))) {
        res.writeHead(403);
        return res.end('Forbidden');
      }
      return serveFile(res, fullPath);
    }

    // 404
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
    if (now > new Date(share.expiresAt)) {
      shareLinks.delete(id);
    }
  }
}, 60 * 1000);

server.listen(PORT, () => {
  console.log('');
  console.log('=================================');
  console.log('  名片王 - 智能名片掃描管理系統');
  console.log('=================================');
  console.log(`  本地網址: http://localhost:${PORT}`);
  console.log('  準備就緒，開始掃描名片吧！');
  console.log('=================================');
  console.log('');
});
