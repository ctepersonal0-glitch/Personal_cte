// =============================================
// CTE - Apps Script para gestión de usuarios
// Pegar en: Extensiones > Apps Script
// =============================================

const SHEET_NAME = 'CTE_Usuarios';

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  const params = e.parameter;
  const action = params.action;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

  let result = {};

  try {
    if (action === 'getUsers') {
      result = getUsers(sheet);
    } else if (action === 'saveUsers') {
      const users = JSON.parse(params.users);
      result = saveUsers(sheet, users);
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

function saveUsers(sheet, users) {
  // Clear all data except headers
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 9).clearContent();
  }
  
  // Write users
  users.forEach((u, i) => {
    sheet.getRange(i + 2, 1, 1, 9).setValues([[
      u.user || '',
      u.passHash || '',
      u.nombre || '',
      u.rol || 'user',
      u.email || '',
      String(u.blocked || false),
      u.area || '',
      u.provincia || '',
      u.codigo || ''
    ]]);
  });
  
  return { ok: true, saved: users.length };
}
