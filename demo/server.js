const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const initSqlJs = require('sql.js');

const PORT = Number(process.env.PORT || 4180);
const clientConfigs = new Map([
  [process.env.QA_CUSTOMER_CLIENT_ID, {
    secret: process.env.QA_CUSTOMER_CLIENT_SECRET,
    scopes: ['policies:read', 'policies:write', 'claims:submit', 'claims:read'],
  }],
  [process.env.QA_ADJUSTER_CLIENT_ID, {
    secret: process.env.QA_ADJUSTER_CLIENT_SECRET,
    scopes: ['policies:read', 'claims:read', 'claims:adjust'],
  }],
].filter(([id, config]) => id && config.secret));

const tokens = new Map();
const policies = new Map();
const claims = new Map();
const idempotency = new Map();
const rateProbes = new Map();
const TOKEN_LIFETIME_SECONDS = 900;
const databaseFile = path.join(__dirname, '..', '.runtime', 'northstar.sqlite');
let database;

function persistDatabase() {
  const output = Buffer.from(database.export());
  fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
  const temporaryFile = `${databaseFile}.tmp`;
  fs.writeFileSync(temporaryFile, output);
  fs.renameSync(temporaryFile, databaseFile);
}

function savePolicy(policy) {
  policies.set(policy.id, policy);
  database.run('INSERT OR REPLACE INTO policies (id, policyholder_id, type, status, effective_date, coverage_amount, payload) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    policy.id, policy.policyholderId, policy.type, policy.status, policy.effectiveDate, policy.coverageAmount, JSON.stringify(policy),
  ]);
  persistDatabase();
}

function removePolicy(id) {
  policies.delete(id);
  database.run('DELETE FROM policies WHERE id = ?', [id]);
  persistDatabase();
}

function saveClaim(claim) {
  claims.set(claim.id, claim);
  database.run('INSERT OR REPLACE INTO claims (id, policy_id, status, incident_date, claimed_amount, payload) VALUES (?, ?, ?, ?, ?, ?)', [
    claim.id, claim.policyId, claim.status, claim.incidentDate, claim.claimedAmount, JSON.stringify(claim),
  ]);
  persistDatabase();
}

function saveIdempotency(key, fingerprint, claim) {
  idempotency.set(key, { fingerprint, claim });
  database.run('INSERT OR REPLACE INTO idempotency_keys (key, fingerprint, claim_id) VALUES (?, ?, ?)', [key, fingerprint, claim.id]);
  persistDatabase();
}

function send(res, status, payload, headers = {}) {
  const common = { 'X-Request-Id': res.locals.requestId, ...headers };
  if (res.locals.apiVersion) common['X-API-Version'] = '1';
  if (status === 204) { res.writeHead(status, common).end(); return; }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...common });
  res.end(JSON.stringify(payload));
}

function fail(res, status, code, message, extraHeaders = {}) {
  send(res, status, { error: { code, message, requestId: res.locals.requestId } }, extraHeaders);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 1024 * 1024) { reject(Object.assign(new Error('Request body exceeds 1 MiB.'), { status: 413 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!size) { resolve(undefined); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Request body must be valid JSON.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function makeId(prefix) { return `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`; }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function constantTimeMatch(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function issueToken(req, res, body) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') {
    fail(res, 415, 'unsupported_media_type', 'Token requests must use application/x-www-form-urlencoded.'); return;
  }
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Basic ')) { fail(res, 401, 'invalid_client', 'Client authentication is required.', { 'WWW-Authenticate': 'Basic realm="oauth"' }); return; }
  let decoded;
  try { decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8'); }
  catch { decoded = ''; }
  const separator = decoded.indexOf(':');
  const clientId = separator < 0 ? '' : decoded.slice(0, separator);
  const secret = separator < 0 ? '' : decoded.slice(separator + 1);
  const client = clientConfigs.get(clientId);
  if (!client || !constantTimeMatch(secret, client.secret)) { fail(res, 401, 'invalid_client', 'Client authentication failed.', { 'WWW-Authenticate': 'Basic realm="oauth"' }); return; }
  if (body?.get('grant_type') !== 'client_credentials') { fail(res, 400, 'unsupported_grant_type', 'Only the client_credentials grant is supported.'); return; }
  const requested = (body.get('scope') || client.scopes.join(' ')).split(/\s+/).filter(Boolean);
  if (requested.some(scope => !client.scopes.includes(scope))) { fail(res, 400, 'invalid_scope', 'The requested scope is not granted to this client.'); return; }
  const accessToken = randomBytes(32).toString('base64url');
  tokens.set(accessToken, { scopes: requested, expiresAt: Date.now() + TOKEN_LIFETIME_SECONDS * 1000 });
  send(res, 200, { access_token: accessToken, token_type: 'Bearer', expires_in: TOKEN_LIFETIME_SECONDS, scope: requested.join(' ') }, { 'Cache-Control': 'no-store', Pragma: 'no-cache' });
}

function principal(req) {
  const match = /^Bearer\s+([^\s]+)$/i.exec(req.headers.authorization || '');
  if (!match) return undefined;
  const token = tokens.get(match[1]);
  if (!token || token.expiresAt <= Date.now()) { tokens.delete(match[1]); return undefined; }
  return { token: match[1], scopes: token.scopes };
}

function requireScope(req, res, scope) {
  const user = principal(req);
  if (!user) { fail(res, 401, 'unauthorized', 'A valid bearer token is required.', { 'WWW-Authenticate': 'Bearer' }); return undefined; }
  if (!user.scopes.includes(scope)) { fail(res, 403, 'insufficient_scope', `Required scope: ${scope}`, { 'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${scope}"` }); return undefined; }
  return user;
}

function validatePolicy(value) {
  if (!isRecord(value)) return 'A JSON object is required.';
  const allowed = ['policyholderId', 'type', 'effectiveDate', 'coverageAmount'];
  if (Object.keys(value).some(key => !allowed.includes(key))) return 'Only policyholderId, type, effectiveDate, and coverageAmount are accepted.';
  if (typeof value.policyholderId !== 'string' || value.policyholderId.trim().length < 3 || value.policyholderId.length > 80) return 'policyholderId must contain 3 to 80 characters.';
  if (!['auto', 'home', 'life'].includes(value.type)) return 'type must be auto, home, or life.';
  if (!validDate(value.effectiveDate)) return 'effectiveDate must be a valid YYYY-MM-DD date.';
  if (typeof value.coverageAmount !== 'number' || !Number.isFinite(value.coverageAmount) || value.coverageAmount < 1000 || value.coverageAmount > 1_000_000) return 'coverageAmount must be between 1000 and 1000000.';
  return undefined;
}

function validateClaim(value, policy) {
  if (!isRecord(value)) return 'A JSON object is required.';
  const allowed = ['policyId', 'incidentDate', 'description', 'claimedAmount'];
  if (Object.keys(value).some(key => !allowed.includes(key))) return 'Only policyId, incidentDate, description, and claimedAmount are accepted.';
  if (typeof value.policyId !== 'string' || !policies.has(value.policyId)) return 'policyId must identify an existing policy.';
  if (policy.status !== 'active') return 'Claims can only be submitted against an active policy.';
  if (!validDate(value.incidentDate) || value.incidentDate < policy.effectiveDate) return 'incidentDate must be valid and on or after policy effectiveDate.';
  if (typeof value.description !== 'string' || value.description.trim().length < 10 || value.description.length > 500) return 'description must contain 10 to 500 characters.';
  if (typeof value.claimedAmount !== 'number' || !Number.isFinite(value.claimedAmount) || value.claimedAmount <= 0 || value.claimedAmount > policy.coverageAmount) return 'claimedAmount must be greater than zero and no greater than policy coverage.';
  return undefined;
}

function parsePositiveInteger(value, fallback) {
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  res.locals = { requestId: /^[\w.-]{1,80}$/.test(req.headers['x-request-id'] || '') ? req.headers['x-request-id'] : randomBytes(12).toString('hex'), apiVersion: url.pathname.startsWith('/v1/') };

  if (req.method === 'GET' && url.pathname === '/health') { send(res, 200, { status: 'ok' }); return; }
  if (req.method === 'POST' && url.pathname === '/oauth/token') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    issueToken(req, res, new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
    return;
  }

  if (url.pathname === '/v1/metadata' && req.method === 'GET') {
    if (!requireScope(req, res, 'policies:read')) return;
    send(res, 200, { service: 'northstar-insurance-api', version: '1' }, { 'Set-Cookie': 'northstar-region=global; Path=/; HttpOnly; SameSite=Lax; Max-Age=300' }); return;
  }

  if (url.pathname === '/v1/rate-limit/probe' && req.method === 'GET') {
    const user = requireScope(req, res, 'policies:read'); if (!user) return;
    const count = (rateProbes.get(user.token) || 0) + 1; rateProbes.set(user.token, count);
    if (count > 2) { fail(res, 429, 'rate_limit_exceeded', 'The probe limit is two requests per token.', { 'Retry-After': '1' }); return; }
    send(res, 200, { remaining: 2 - count }); return;
  }

  if (url.pathname === '/v1/policies' && req.method === 'POST') {
    if (!requireScope(req, res, 'policies:write')) return;
    let body; try { body = await readBody(req); } catch (error) { fail(res, error.status || 400, error.status === 413 ? 'payload_too_large' : 'invalid_json', error.message); return; }
    const issue = validatePolicy(body); if (issue) { fail(res, 422, 'validation_error', issue); return; }
    const policy = { id: makeId('POL'), ...body, policyholderId: body.policyholderId.trim(), status: 'active', createdAt: new Date().toISOString() };
    savePolicy(policy);
    send(res, 201, policy, { Location: `/v1/policies/${policy.id}`, ETag: `"${policy.id}-1"` }); return;
  }

  if (url.pathname === '/v1/policies' && req.method === 'GET') {
    if (!requireScope(req, res, 'policies:read')) return;
    const page = parsePositiveInteger(url.searchParams.get('page'), 1);
    const pageSize = parsePositiveInteger(url.searchParams.get('pageSize'), 10);
    if (!page || !pageSize || pageSize > 20) { fail(res, 400, 'invalid_pagination', 'page must be positive and pageSize must be between 1 and 20.'); return; }
    const status = url.searchParams.get('status');
    if (status && !['active', 'cancelled'].includes(status)) { fail(res, 400, 'invalid_filter', 'status must be active or cancelled.'); return; }
    const all = [...policies.values()].filter(policy => !status || policy.status === status);
    const offset = (page - 1) * pageSize;
    send(res, 200, { items: all.slice(offset, offset + pageSize), total: all.length, page, pageSize, totalPages: Math.ceil(all.length / pageSize) }); return;
  }

  const policyMatch = /^\/v1\/policies\/([^/]+)$/.exec(url.pathname);
  if (policyMatch) {
    const id = decodeURIComponent(policyMatch[1]);
    if (req.method === 'GET') {
      if (!requireScope(req, res, 'policies:read')) return;
      const policy = policies.get(id); if (!policy) { fail(res, 404, 'not_found', 'Policy was not found.'); return; }
      send(res, 200, policy, { ETag: `"${policy.id}-1"` }); return;
    }
    if (req.method === 'PUT') {
      if (!requireScope(req, res, 'policies:write')) return;
      const current = policies.get(id); if (!current) { fail(res, 404, 'not_found', 'Policy was not found.'); return; }
      let body; try { body = await readBody(req); } catch (error) { fail(res, error.status || 400, 'invalid_json', error.message); return; }
      const issue = validatePolicy(body); if (issue) { fail(res, 422, 'validation_error', issue); return; }
      const replacement = { id: current.id, ...body, policyholderId: body.policyholderId.trim(), status: current.status, createdAt: current.createdAt };
      savePolicy(replacement); send(res, 200, replacement, { ETag: `"${id}-2"` }); return;
    }
    if (req.method === 'PATCH') {
      if (!requireScope(req, res, 'policies:write')) return;
      const current = policies.get(id); if (!current) { fail(res, 404, 'not_found', 'Policy was not found.'); return; }
      let body; try { body = await readBody(req); } catch (error) { fail(res, error.status || 400, 'invalid_json', error.message); return; }
      if (!isRecord(body) || !Object.keys(body).length || Object.keys(body).some(key => !['coverageAmount', 'status'].includes(key))) { fail(res, 422, 'validation_error', 'PATCH accepts coverageAmount and/or status.'); return; }
      if ('coverageAmount' in body && (typeof body.coverageAmount !== 'number' || body.coverageAmount < 1000 || body.coverageAmount > 1_000_000)) { fail(res, 422, 'validation_error', 'coverageAmount must be between 1000 and 1000000.'); return; }
      if ('status' in body && !['active', 'cancelled'].includes(body.status)) { fail(res, 422, 'validation_error', 'status must be active or cancelled.'); return; }
      const updated = { ...current, ...body }; savePolicy(updated); send(res, 200, updated, { ETag: `"${id}-2"` }); return;
    }
    if (req.method === 'DELETE') {
      if (!requireScope(req, res, 'policies:write')) return;
      if (!policies.has(id)) { fail(res, 404, 'not_found', 'Policy was not found.'); return; }
      if ([...claims.values()].some(claim => claim.policyId === id)) { fail(res, 409, 'policy_has_claims', 'A policy with submitted claims cannot be deleted.'); return; }
      removePolicy(id); send(res, 204); return;
    }
  }

  if (url.pathname === '/v1/claims' && req.method === 'POST') {
    if (!requireScope(req, res, 'claims:submit')) return;
    let body; try { body = await readBody(req); } catch (error) { fail(res, error.status || 400, 'invalid_json', error.message); return; }
    const policy = policies.get(body?.policyId);
    const issue = validateClaim(body, policy || {}); if (issue) { fail(res, 422, 'validation_error', issue); return; }
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !/^[\w.:-]{8,128}$/.test(key)) { fail(res, 400, 'idempotency_key_required', 'Idempotency-Key must contain 8 to 128 safe characters.'); return; }
    const fingerprint = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const prior = idempotency.get(key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) { fail(res, 409, 'idempotency_conflict', 'This Idempotency-Key was already used with a different request.'); return; }
      send(res, 200, prior.claim, { Location: `/v1/claims/${prior.claim.id}`, 'Idempotency-Replayed': 'true' }); return;
    }
    const claim = { id: makeId('CLM'), policyId: body.policyId, incidentDate: body.incidentDate, description: body.description.trim(), claimedAmount: body.claimedAmount, status: 'submitted', createdAt: new Date().toISOString() };
    saveClaim(claim); saveIdempotency(key, fingerprint, claim);
    send(res, 201, claim, { Location: `/v1/claims/${claim.id}`, 'Idempotency-Replayed': 'false' }); return;
  }

  const claimMatch = /^\/v1\/claims\/([^/]+)$/.exec(url.pathname);
  if (claimMatch) {
    const id = decodeURIComponent(claimMatch[1]);
    if (req.method === 'GET') {
      if (!requireScope(req, res, 'claims:read')) return;
      const claim = claims.get(id); if (!claim) { fail(res, 404, 'not_found', 'Claim was not found.'); return; }
      send(res, 200, claim); return;
    }
    if (req.method === 'PATCH') {
      if (!requireScope(req, res, 'claims:adjust')) return;
      const claim = claims.get(id); if (!claim) { fail(res, 404, 'not_found', 'Claim was not found.'); return; }
      let body; try { body = await readBody(req); } catch (error) { fail(res, error.status || 400, 'invalid_json', error.message); return; }
      if (!isRecord(body) || Object.keys(body).length !== 1 || !['under_review', 'approved', 'rejected'].includes(body.status)) { fail(res, 422, 'validation_error', 'PATCH requires a supported claim status.'); return; }
      const allowed = claim.status === 'submitted' ? ['under_review'] : claim.status === 'under_review' ? ['approved', 'rejected'] : [];
      if (!allowed.includes(body.status)) { fail(res, 409, 'invalid_transition', `Cannot transition claim from ${claim.status} to ${body.status}.`); return; }
      const updated = { ...claim, status: body.status }; saveClaim(updated); send(res, 200, updated); return;
    }
  }

  fail(res, 404, 'not_found', 'Route was not found.');
});

async function start() {
  const SQL = await initSqlJs({ locateFile: file => path.join(path.dirname(require.resolve('sql.js')), file) });
  database = new SQL.Database();
  database.run(`
    CREATE TABLE policies (
      id TEXT PRIMARY KEY, policyholder_id TEXT NOT NULL, type TEXT NOT NULL,
      status TEXT NOT NULL, effective_date TEXT NOT NULL, coverage_amount REAL NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE claims (
      id TEXT PRIMARY KEY, policy_id TEXT NOT NULL REFERENCES policies(id), status TEXT NOT NULL,
      incident_date TEXT NOT NULL, claimed_amount REAL NOT NULL, payload TEXT NOT NULL
    );
    CREATE TABLE idempotency_keys (
      key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, claim_id TEXT NOT NULL REFERENCES claims(id)
    );
  `);
  database.run('PRAGMA foreign_keys = ON');
  persistDatabase();
  server.listen(PORT, '127.0.0.1');
}

start().catch(error => { console.error(`Demo API failed to initialize: ${error.message}`); process.exitCode = 1; });
server.on('error', error => { console.error(`Demo API failed to start: ${error.message}`); process.exitCode = 1; });
