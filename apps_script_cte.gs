// =============================================
// CTE - Apps Script para gestión de usuarios
// Versión segura con SECRET_TOKEN y LockService
// Pegar en: Extensiones > Apps Script
// =============================================

const SHEET_NAME = 'CTE_Usuarios';
const SHEET_SOLICITUDES = 'CTE_Solicitudes';
const SECRET_TOKEN = 'cte-token-seguro-2026';

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  const params = e.parameter;

  // ── Validación de token de seguridad ──────────────────────────
  if (params.token !== SECRET_TOKEN) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: 'Acceso no autorizado.' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const action = params.action;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

  let result = {};

  try {
    if (action === 'getUsers') {
      result = getUsers(sheet);
    } else if (action === 'saveUsers') {
      result = saveUsersLocked(sheet, params);
    } else if (action === 'getSolicitudes') {
      const sheetSol = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SOLICITUDES);
      result = getSolicitudes(sheetSol);
    } else if (action === 'saveSolicitudes') {
      const sheetSol = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SOLICITUDES);
      result = saveSolicitudesLocked(sheetSol, params);
    } else {
      result = { ok: false, error: 'Acción no reconocida.' };
    }
  } catch(err) {
    result = { ok: false, error: err.toString() };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function getUsers(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { ok: true, users: [] };

  const headers = data[0];
  const users = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue; // skip empty rows
    const user = {};
    headers.forEach((h, idx) => {
      user[h] = row[idx] === '' ? '' : String(row[idx]);
    });
    user.blocked = user.blocked === 'true';
    users.push(user);
  }

  return { ok: true, users };
}

// ── saveUsers con LockService para evitar escrituras simultáneas ──
function saveUsersLocked(sheet, params) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // espera hasta 10 s para obtener el lock
  } catch (e) {
    return { ok: false, error: 'Servidor ocupado, intenta de nuevo.' };
  }

  try {
    const users = JSON.parse(params.users);
    return saveUsers(sheet, users);
  } finally {
    lock.releaseLock();
  }
}

function saveUsers(sheet, users) {
  if (!users || users.length === 0) {
    return { ok: false, error: 'No se recibieron usuarios.' };
  }

  // Determinar cabeceras a partir del primer usuario
  const headers = Object.keys(users[0]);

  const rows = users.map(u => headers.map(h => {
    const val = u[h];
    return (val === null || val === undefined) ? '' : String(val);
  }));

  // Limpiar hoja y reescribir
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  return { ok: true, saved: rows.length };
}

// ── SOLICITUDES ───────────────────────────────────────────────────

function getSolicitudes(sheet) {
  if (!sheet) return { ok: true, solicitudes: [] };
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { ok: true, solicitudes: [] };

  const headers = data[0];
  const solicitudes = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const sol = {};
    headers.forEach((h, idx) => { sol[h] = row[idx] === '' ? '' : String(row[idx]); });
    // id debe ser número para que coincida con onclick="aprobarSolicitud(id)"
    if (sol.id) sol.id = Number(sol.id);
    solicitudes.push(sol);
  }
  return { ok: true, solicitudes };
}

function saveSolicitudesLocked(sheet, params) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { ok: false, error: 'Servidor ocupado, intenta de nuevo.' };
  }
  try {
    const solicitudes = JSON.parse(decodeURIComponent(params.solicitudes));
    return saveSolicitudes(sheet, solicitudes);
  } finally {
    lock.releaseLock();
  }
}

function saveSolicitudes(sheet, solicitudes) {
  // Si no existe la hoja, crearla automáticamente
  if (!sheet) {
    sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(SHEET_SOLICITUDES);
  }

  if (!solicitudes || solicitudes.length === 0) {
    // Limpiar hoja pero mantener cabeceras si existen
    const existingData = sheet.getDataRange().getValues();
    if (existingData.length > 1) {
      sheet.getRange(2, 1, existingData.length - 1, existingData[0].length).clearContent();
    }
    return { ok: true, saved: 0 };
  }

  const headers = ['id', 'area', 'provincia', 'codigo', 'email', 'fecha', 'estado'];
  const rows = solicitudes.map(s => headers.map(h => {
    const val = s[h];
    return (val === null || val === undefined) ? '' : String(val);
  }));

  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  return { ok: true, saved: rows.length };
}
