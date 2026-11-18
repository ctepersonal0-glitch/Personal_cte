// ==================== CONFIGURACIÓN INICIAL ====================
// Autenticación: Firebase Authentication (Google). Ver firestore.rules.

// ==================== TOASTS ====================
function showToast(msg, type='info', duration=3500){
  const icons = {success:'✅', error:'❌', info:'ℹ️'};
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type]||'•'}</span><span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(()=>{
    toast.classList.add('toast-out');
    toast.addEventListener('animationend',()=>toast.remove());
  }, duration);
}

// ==================== LOGIN TABS ====================
function switchLoginTab(tab){
  document.querySelectorAll('.login-tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.login-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-'+tab).classList.add('active');
  [...document.querySelectorAll('.login-tab-btn')].find(b=>b.textContent.toLowerCase().includes(tab==='ingresar'?'ingresar':'registr')).classList.add('active');
}

const FILES_BASE = [
  { id:1779224557782, nombre:'HISTORIAL CTE', seccion:'organico', tipo:'excel', desc:'', fecha:'19/05/2026', urlOriginal:'https://drive.google.com/drive/folders/1IKszLxBRMZTpv0CyJYaFJ11KbmaftAlW?usp=sharing' },
  { id:1780069150402, nombre:'ORGANICO', seccion:'organico', tipo:'excel', desc:'', fecha:'29/5/2026', urlOriginal:'https://drive.google.com/drive/folders/1aiqSt2DEzT7_LTuEVcy19J-Y3_-iRihN?usp=drive_link' },
  { id:1780069566182, nombre:'LISTADO PARAMETROS 2026', seccion:'parametros', tipo:'excel', desc:'', fecha:'29/5/2026', urlOriginal:'https://drive.google.com/drive/folders/1XPel3aDUBnMdyCMTGpBhIW0GPP98F5dh?usp=drive_link' },
  { id:1780070483456, nombre:'ORDEN DEL CUERPO 2026', seccion:'orden', tipo:'pdf', desc:'', fecha:'29/5/2026', urlOriginal:'https://drive.google.com/drive/folders/1Np2lvD-Rlgxkkq9_OGPIrlJAHrRyiE3M?usp=drive_link' },
];

// ==================== USUARIOS (Firestore + Firebase Auth) ====================
// Cada usuario es el documento users/{correo-en-minúsculas}.
// El rol y el bloqueo los valida Firestore mediante firestore.rules (no solo este código).
let USERS = [];                 // solo se llena para el administrador
let solicitudesUnsubscribe = null;
let usersUnsubscribe = null;
let selfUnsubscribe = null;
let archivosUnsubscribe = null;
let _loginInteractivo = false;

function userDocId(u){ return String((u && u.email) || '').trim().toLowerCase(); }

// Lista completa de usuarios en tiempo real (SOLO ADMINISTRADOR)
function listenToUsers() {
  if (usersUnsubscribe) usersUnsubscribe();
  usersUnsubscribe = db.collection('users').onSnapshot((snapshot) => {
    USERS = [];
    snapshot.forEach(doc => USERS.push({ id: doc.id, ...doc.data() }));
    if (currentUser && currentUser.rol === 'admin') {
      const st = document.getElementById('stat-total');
      if (st) st.textContent = USERS.length;
      renderAdmin();
    }
  }, (error) => { console.error('Error escuchando usuarios:', error); });
}

// Escucha el propio documento: si el admin bloquea, elimina o cambia el rol, la sesión se cierra
function listenToSelf(email) {
  if (selfUnsubscribe) selfUnsubscribe();
  selfUnsubscribe = db.collection('users').doc(email).onSnapshot((doc) => {
    if (!currentUser) return;
    if (!doc.exists || doc.data().blocked === true) {
      doLogout();
      mostrarError('SU CUENTA FUE BLOQUEADA O ELIMINADA. CONTACTE AL ADMINISTRADOR.');
      return;
    }
    const d = { id: doc.id, ...doc.data() };
    if (d.rol !== currentUser.rol) {
      doLogout();
      mostrarError('SU ROL CAMBIÓ. INGRESE NUEVAMENTE.');
      return;
    }
    currentUser = d;
  }, (error) => { console.error('Error escuchando usuario:', error); });
}

async function saveUser(u) {
  const data = { ...u };
  delete data.id;
  await db.collection('users').doc(userDocId(u)).set(data, { merge: true });
}

function detenerListeners() {
  [usersUnsubscribe, solicitudesUnsubscribe, selfUnsubscribe, archivosUnsubscribe].forEach(fn => { if (fn) fn(); });
  usersUnsubscribe = solicitudesUnsubscribe = selfUnsubscribe = archivosUnsubscribe = null;
  USERS = [];
  FILES_REMOTE = [];
}

function getUserByEmail(email) {
  return USERS.find(u => u.email && u.email.toLowerCase() === email.toLowerCase());
}

function isBlocked(userObj) {
  return userObj.blocked === true;
}

function toggleBlockUser(username, block) {
  const user = USERS.find(u => u.user === username);
  if (!user || user.rol === 'admin') return;
  user.blocked = block;
  saveUser(user).catch(() => showToast('NO SE PUDO GUARDAR EL CAMBIO', 'error'));
  if (currentUser && currentUser.rol === 'admin') {
    renderAdmin();
  }
}

// ==================== ACCIONES INLINE DE USUARIOS ====================

async function deleteUser(username) {
  const user = USERS.find(u => u.user === username);
  if (!user) return;
  if (user.rol === 'admin') { 
    showToast('NO SE PUEDE ELIMINAR AL ADMINISTRADOR PRINCIPAL', 'error'); 
    return; 
  }
  
  openModal('ELIMINAR USUARIO', `¿ELIMINAR COMPLETAMENTE A ${user.nombre}? SE BORRARÁN TAMBIÉN SUS LOGS Y SOLICITUDES.`, async () => {
    try {
      const batch = db.batch();

      // 1. Eliminar documento del usuario
      batch.delete(db.collection('users').doc(userDocId(user)));

      // 2. Eliminar todos sus logs
      const logsSnap = await db.collection('logs')
        .where('usuario', '==', username)
        .get();
      logsSnap.forEach(doc => batch.delete(doc.ref));

      // 3. Eliminar todas sus solicitudes (por email)
      if (user.email) {
        const solicSnap = await db.collection('solicitudes')
          .where('email', '==', user.email)
          .get();
        solicSnap.forEach(doc => batch.delete(doc.ref));
        batch.delete(db.collection('solicitudes').doc(userDocId(user)));
      }

      await batch.commit();

      // 4. Limpiar del array local y caché
      USERS = USERS.filter(u => u.user !== username);

      renderAdmin();
      showToast(`USUARIO ${user.nombre} ELIMINADO COMPLETAMENTE`, 'success');

    } catch (err) {
      console.error('Error al eliminar usuario:', err);
      showToast('ERROR AL ELIMINAR. REVISA LA CONSOLA.', 'error');
    }
  });
}
async function toggleAdminRole(username) {
  const user = USERS.find(u => u.user === username);
  if (!user || user.user === currentUser.user) { showToast('NO PUEDES MODIFICAR TU PROPIO ROL', 'error'); return; }
  const nuevoRol = user.rol === 'admin' ? 'user' : 'admin';
  const label = nuevoRol === 'admin' ? 'ADMINISTRADOR' : 'USUARIO';
  openModal('CAMBIAR ROL', `¿CAMBIAR ROL DE ${user.nombre} A ${label}?`, async () => {
    user.rol = nuevoRol;
    try { await saveUser(user); } catch (e) { showToast('NO SE PUDO GUARDAR EL CAMBIO', 'error'); return; }
    renderAdmin();
    showToast(`ROL DE ${user.nombre} CAMBIADO A ${label}`, 'success');
  });
}

// ==================== SOLICITUDES DE REGISTRO ====================

function listenToSolicitudes() {
  if (solicitudesUnsubscribe) solicitudesUnsubscribe();
  
  solicitudesUnsubscribe = db.collection('solicitudes')
    .where('estado', '==', 'pendiente')
    .onSnapshot((snapshot) => {
      const solicitudes = [];
      snapshot.forEach(doc => {
        solicitudes.push({ id: doc.id, ...doc.data() });
      });

      solicitudes.sort((a, b) => {
        const ta = a.timestamp ? a.timestamp.seconds : 0;
        const tb = b.timestamp ? b.timestamp.seconds : 0;
        return tb - ta;
      });
      
      window._solicitudesCache = solicitudes;
      
      if (currentUser && currentUser.rol === 'admin') {
        renderSolicitudes();
        
        const existingToast = document.querySelector('.toast-real-time');
        if (!existingToast && solicitudes.length > 0) {
          showToast(`📨 ${solicitudes.length} solicitud(es) pendiente(s) de aprobación`, 'info', 5000);
          try {
            const audio = new Audio('https://www.soundjay.com/misc/sounds/bell-ringing-05.mp3');
            audio.volume = 0.3;
            audio.play().catch(e => console.log('Audio no soportado'));
          } catch(e) {}
        }
      }
    }, (error) => {
      console.error('Error escuchando solicitudes:', error);
    });
}

// ==================== BASE DE PERSONAL (CÓDIGO → AGENTE) ====================
const BASE_PERSONAL_COL = 'base_personal';
const BASE_PERSONAL_META = { col: 'config', doc: 'base_personal' };
const BASE_LOTE = 400;

function normalizarCodigo(v){
  return String(v || '').replace(/[^0-9]/g, '').replace(/^0+/, '');
}

// Consulta la base de personal (SOLO ADMINISTRADOR, lo exigen las reglas de Firestore)
async function buscarAgenteBase(codigo, sol = {}) {
  const cod = normalizarCodigo(codigo);
  try {
    const d = await db.collection(BASE_PERSONAL_COL).doc(cod).get();
    if (d.exists) {
      const x = d.data();
      return { enBase: true, completo: true, codigo: cod, grado: x.grado || '', apellidos: x.apellidos || '', nombres: x.nombres || '', area: x.area || '' };
    }
  } catch (e) { console.error('Error consultando base de personal:', e); }
  // Solicitudes antiguas ya traían los datos copiados
  return { enBase: false, completo: !!(sol.apellidos || sol.nombres), codigo: cod, grado: sol.grado || '', apellidos: sol.apellidos || '', nombres: sol.nombres || '', area: sol.area || '' };
}

// ---- Actualización de la base (SOLO ADMINISTRADOR) ----
function _normHeader(h){
  return String(h || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

async function renderBasePersonalInfo(){
  const el = document.getElementById('base-personal-info');
  if (!el) return;
  try {
    const doc = await db.collection(BASE_PERSONAL_META.col).doc(BASE_PERSONAL_META.doc).get();
    if (!doc.exists) { el.textContent = 'BASE AÚN NO CARGADA.'; return; }
    const d = doc.data();
    el.innerHTML = `📄 <strong>${d.total || 0}</strong> REGISTROS · ÚLTIMA ACTUALIZACIÓN: ${esc(d.fecha || '—')} · POR: ${esc(d.actualizadoPor || '—')}`;
  } catch (err) {
    el.textContent = 'NO SE PUDO LEER LA INFORMACIÓN DE LA BASE.';
  }
}

async function subirBasePersonal(){
  if (!currentUser || currentUser.rol !== 'admin') {
    showToast('SOLO EL ADMINISTRADOR PUEDE ACTUALIZAR LA BASE DE PERSONAL', 'error');
    return;
  }

  const input = document.getElementById('base-file');
  const estado = document.getElementById('base-estado');
  const file = input && input.files ? input.files[0] : null;

  if (!file) { showToast('SELECCIONE EL ARCHIVO EXCEL', 'error'); return; }
  if (typeof XLSX === 'undefined') { showToast('NO SE CARGÓ LA LIBRERÍA DE EXCEL. RECARGUE LA PÁGINA.', 'error'); return; }

  estado.textContent = 'LEYENDO ARCHIVO...';

  let registros = [];
  try {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (!filas.length) { estado.textContent = '❌ EL ARCHIVO NO TIENE FILAS.'; return; }

    const mapa = {};
    Object.keys(filas[0]).forEach(k => { mapa[_normHeader(k)] = k; });

    const kCod = mapa['CODIGO'];
    const kArea = mapa['AREA ACTUAL'] || mapa['AREA'];
    const kGrado = mapa['GRADO'];
    const kApe = mapa['APELLIDOS'];
    const kNom = mapa['NOMBRES'];

    if (!kCod || !kArea) {
      estado.textContent = '❌ EL ARCHIVO DEBE TENER AL MENOS LAS COLUMNAS CODIGO Y AREA ACTUAL.';
      return;
    }

    const vistos = new Set();
    filas.forEach(f => {
      const codigo = normalizarCodigo(f[kCod]);
      if (!codigo || vistos.has(codigo)) return;
      vistos.add(codigo);
      registros.push({
        codigo: codigo,
        grado: String(kGrado ? f[kGrado] : '').trim().toUpperCase(),
        apellidos: String(kApe ? f[kApe] : '').trim().toUpperCase(),
        nombres: String(kNom ? f[kNom] : '').trim().toUpperCase(),
        area: String(f[kArea] || '').trim().toUpperCase()
      });
    });
  } catch (err) {
    console.error(err);
    estado.textContent = '❌ NO SE PUDO LEER EL ARCHIVO: ' + err.message;
    return;
  }

  if (!registros.length) { estado.textContent = '❌ NO SE ENCONTRARON REGISTROS VÁLIDOS.'; return; }

  openModal(
    'ACTUALIZAR BASE DE PERSONAL',
    `SE REEMPLAZARÁ TODA LA BASE POR ${registros.length} REGISTROS DEL ARCHIVO "${file.name}". ¿CONTINUAR?`,
    async () => {
      try {
        estado.textContent = 'ELIMINANDO BASE ANTERIOR...';
        const snap = await db.collection(BASE_PERSONAL_COL).get();
        const docs = snap.docs;

        for (let i = 0; i < docs.length; i += BASE_LOTE) {
          const batch = db.batch();
          docs.slice(i, i + BASE_LOTE).forEach(d => batch.delete(d.ref));
          await batch.commit();
          estado.textContent = `ELIMINANDO BASE ANTERIOR... ${Math.min(i + BASE_LOTE, docs.length)}/${docs.length}`;
        }

        for (let i = 0; i < registros.length; i += BASE_LOTE) {
          const batch = db.batch();
          registros.slice(i, i + BASE_LOTE).forEach(r => {
            batch.set(db.collection(BASE_PERSONAL_COL).doc(r.codigo), {
              grado: r.grado, apellidos: r.apellidos, nombres: r.nombres, area: r.area
            });
          });
          await batch.commit();
          estado.textContent = `SUBIENDO REGISTROS... ${Math.min(i + BASE_LOTE, registros.length)}/${registros.length}`;
        }

        await db.collection(BASE_PERSONAL_META.col).doc(BASE_PERSONAL_META.doc).set({
          total: registros.length,
          fecha: new Date().toLocaleString('es-EC'),
          actualizadoPor: currentUser.nombre || currentUser.user,
          archivo: file.name
        });

        estado.textContent = `✅ BASE ACTUALIZADA: ${registros.length} REGISTROS.`;
        input.value = '';
        addLog(currentUser.user, currentUser.nombre, 'aprobacion', currentUser.email || '',
          `BASE DE PERSONAL ACTUALIZADA - ${registros.length} REGISTROS (${file.name})`);
        showToast(`✅ BASE DE PERSONAL ACTUALIZADA (${registros.length} REGISTROS)`, 'success');
        renderBasePersonalInfo();
      } catch (err) {
        console.error(err);
        estado.textContent = '❌ ERROR AL ACTUALIZAR: ' + err.message;
        showToast('ERROR AL ACTUALIZAR LA BASE DE PERSONAL', 'error');
      }
    }
  );
}

// ==================== SOLICITAR REGISTRO ====================
// El solicitante NO consulta la base de personal: solo envía código y correo.
// El administrador verifica el código contra la base al revisar la solicitud.
async function solicitarRegistro() {
  const codigo = normalizarCodigo(document.getElementById('reg-codigo').value);
  const email = document.getElementById('reg-email').value.trim().toLowerCase();

  if (!codigo || !email) {
    mostrarError('INGRESA EL CÓDIGO INSTITUCIONAL Y EL CORREO');
    return;
  }
  if (codigo.length < 4 || codigo.length > 5) {
    mostrarError('EL CÓDIGO INSTITUCIONAL DEBE TENER 4 O 5 DÍGITOS');
    return;
  }
  if (!/^[a-z0-9._%+-]+@gmail\.com$/.test(email)) {
    mostrarError('SOLO SE PERMITEN CORREOS DE GMAIL VÁLIDOS');
    return;
  }

  showToast('ENVIANDO SOLICITUD...', 'info', 2500);

  try {
    // ID = correo: Firestore impide enviar una segunda solicitud con el mismo correo
    await db.collection('solicitudes').doc(email).set({
      codigo,
      email,
      fecha: new Date().toLocaleDateString('es-EC'),
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      estado: 'pendiente'
    });
  } catch (err) {
    if (err && err.code === 'permission-denied') {
      mostrarError('YA EXISTE UNA SOLICITUD PARA ESTE CORREO. SI FUE APROBADA, INGRESE CON GOOGLE; SI NO, ESPERE AL ADMINISTRADOR.');
    } else {
      console.error('Error enviando solicitud:', err);
      mostrarError('NO SE PUDO ENVIAR LA SOLICITUD. INTENTE NUEVAMENTE.');
    }
    return;
  }

  mostrarExito('✅ SOLICITUD ENVIADA. ESPERE LA APROBACIÓN DEL ADMINISTRADOR PARA PODER INGRESAR.');
  document.getElementById('reg-codigo').value = '';
  document.getElementById('reg-email').value = '';
}

async function aprobarSolicitud(id) {
  if (!currentUser || currentUser.rol !== 'admin') return;
  const docRef = db.collection('solicitudes').doc(id);
  const doc = await docRef.get();
  if (!doc.exists) return;

  const solicitud = doc.data();
  const email = String(solicitud.email || '').trim().toLowerCase();

  if (getUserByEmail(email)) {
    showToast('ESE CORREO YA TIENE UNA CUENTA ACTIVA.', 'error');
    return;
  }

  const ag = await buscarAgenteBase(solicitud.codigo, solicitud);
  const nombreAgente = `${ag.apellidos} ${ag.nombres}`.trim();

  const ejecutar = async () => {
    const nombreCompleto = nombreAgente
      ? `${ag.grado ? ag.grado + ' ' : ''}${nombreAgente}`.trim()
      : `SIN DATOS (CÓD. ${ag.codigo})`;
    const baseUsername = email.split('@')[0];
    let username = baseUsername;
    let counter = 1;
    while (USERS.find(u => u.user === username)) {
      username = `${baseUsername}${counter}`;
      counter++;
    }

    const nuevoUsuario = {
      user: username,
      nombre: nombreCompleto,
      rol: 'user',
      email,
      blocked: false,
      area: ag.area,
      codigo: ag.codigo,
      grado: ag.grado,
      apellidos: ag.apellidos,
      nombres: ag.nombres,
      creado: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
      await db.collection('users').doc(email).set(nuevoUsuario);
      await docRef.update({ estado: 'aprobada', fechaAprobacion: firebase.firestore.FieldValue.serverTimestamp() });
    } catch (err) {
      console.error('Error aprobando solicitud:', err);
      showToast('ERROR AL APROBAR. REVISE LA CONSOLA.', 'error');
      return;
    }

    addLog(username, nombreCompleto, 'aprobacion', email,
      `CUENTA APROBADA POR ADMINISTRADOR - ÁREA: ${ag.area || '—'}, CÓDIGO: ${ag.codigo}`);
    showToast(`✅ USUARIO ${nombreCompleto} APROBADO CORRECTAMENTE.`, 'success');
  };

  if (!ag.completo) {
    openModal('CÓDIGO NO ESTÁ EN LA BASE',
      `EL CÓDIGO ${ag.codigo} NO FIGURA EN LA BASE DE PERSONAL. SE CREARÁ LA CUENTA SIN NOMBRE NI ÁREA. ¿APROBAR DE TODAS FORMAS?`,
      ejecutar);
  } else {
    await ejecutar();
  }
}

async function rechazarSolicitud(id) {
  if (!currentUser || currentUser.rol !== 'admin') return;
  const docRef = db.collection('solicitudes').doc(id);
  const doc = await docRef.get();
  if (!doc.exists) return;
  const solicitud = doc.data();

  openModal('RECHAZAR SOLICITUD', `¿RECHAZAR LA SOLICITUD DE ${solicitud.email} (CÓD. ${solicitud.codigo})? SE ELIMINARÁ Y PODRÁ VOLVER A SOLICITAR.`, async () => {
    try {
      await docRef.delete();
    } catch (err) {
      console.error(err);
      showToast('ERROR AL RECHAZAR', 'error');
      return;
    }
    showToast('❌ Solicitud rechazada', 'error');
  });
}

async function renderSolicitudes() {
  const container = document.getElementById('solicitudes-list');
  if (!container) return;

  container.innerHTML = '<div class="file-empty">⏳ CARGANDO SOLICITUDES...</div>';

  let snapshot;
  try {
    snapshot = await db.collection('solicitudes').where('estado', '==', 'pendiente').get();
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div class="file-empty">❌ NO SE PUDIERON LEER LAS SOLICITUDES</div>';
    return;
  }

  const solicitudes = [];
  snapshot.forEach(doc => solicitudes.push({ id: doc.id, ...doc.data() }));

  solicitudes.sort((a, b) => {
    const ta = a.timestamp ? a.timestamp.seconds : 0;
    const tb = b.timestamp ? b.timestamp.seconds : 0;
    return tb - ta;
  });

  if (solicitudes.length === 0) {
    container.innerHTML = '<div class="file-empty">📭 NO HAY SOLICITUDES PENDIENTES</div>';
    return;
  }

  // El admin ve a quién corresponde cada código según la base de personal
  const agentes = await Promise.all(solicitudes.map(s => buscarAgenteBase(s.codigo, s)));

  container.innerHTML = `
    <div class="files-grid">
      ${solicitudes.map((s, i) => {
        const a = agentes[i];
        const nombre = `${a.apellidos} ${a.nombres}`.trim();
        const yaTiene = !!getUserByEmail(s.email || '');
        const aviso = !a.completo
          ? '<br><strong style="color:#c0392b">⚠ CÓDIGO NO ESTÁ EN LA BASE DE PERSONAL</strong>'
          : '';
        const aviso2 = yaTiene ? '<br><strong style="color:#c0392b">⚠ ESTE CORREO YA TIENE CUENTA</strong>' : '';
        return `
        <div class="file-card">
          <div class="file-card-top">
            <div class="file-type-icon file-type-other">📧</div>
            <div>
              <div class="file-card-name">${esc(nombre || 'SIN DATOS')}</div>
              <div class="file-card-meta">${a.grado ? esc(a.grado) + '<br>' : ''}ÁREA: ${esc(a.area || '—')}<br>CÓDIGO: ${esc(s.codigo)}<br>CORREO: ${esc(s.email)}<br>SOLICITADO: ${esc(s.fecha)}${aviso}${aviso2}</div>
            </div>
          </div>
          <div class="file-card-actions">
            <button class="file-card-btn file-card-btn-open btn-approve" data-id="${esc(s.id)}" onclick="aprobarSolicitud(this.dataset.id)">✓ APROBAR</button>
            <button class="file-card-btn file-card-btn-del btn-reject" data-id="${esc(s.id)}" onclick="rechazarSolicitud(this.dataset.id)">✗ RECHAZAR</button>
          </div>
        </div>`;
      }).join('')}
    </div>
  `;
}

// ==================== BITÁCORA EN FIRESTORE ====================
async function addLog(usuario, nombre, estado, email='', details=''){
  const now = new Date();
  const dev = /Mobi|Android/i.test(navigator.userAgent) ? 'MÓVIL' : 'COMPUTADORA';
  
  const logEntry = {
    usuario,
    nombre,
    estado,
    email,
    details,
    fecha: now.toLocaleDateString('es-EC'),
    hora: now.toLocaleTimeString('es-EC'),
    device: dev,
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  };
  
  await db.collection('logs').add(logEntry);
}

async function getLogs() {
  const snapshot = await db.collection('logs')
    .orderBy('timestamp', 'desc')
    .limit(500)
    .get();
  
  const logs = [];
  snapshot.forEach(doc => {
    logs.push(doc.data());
  });
  return logs;
}

// ==================== EXPORTAR A EXCEL ====================
function exportUsersToExcel() {
  let csv = "NOMBRE,USUARIO,ROL,EMAIL,GRADO,ÁREA,CÓDIGO INSTITUCIONAL,ESTADO\n";
  USERS.forEach(u => {
    csv += `"${u.nombre}","${u.user}","${u.rol === 'admin' ? 'ADMINISTRADOR' : 'USUARIO'}","${u.email || ''}","${u.grado || ''}","${u.area || ''}","${u.codigo || ''}","${u.blocked ? 'BLOQUEADO' : 'ACTIVO'}"\n`;
  });
  downloadCSV(csv, `usuarios_cte_${new Date().toISOString().slice(0,19)}.csv`);
}

async function exportLogsToExcel() {
  const logs = await getLogs();
  let csv = "USUARIO,NOMBRE,EMAIL,FECHA,HORA,DISPOSITIVO,ESTADO,DETALLES\n";
  logs.forEach(l => {
    let estadoTexto = l.estado === 'ok' ? 'INGRESO EXITOSO' : (l.estado === 'aprobacion' ? 'APROBACIÓN DE CUENTA' : 'INTENTO FALLIDO');
    csv += `"${l.usuario}","${l.nombre}","${l.email || ''}","${l.fecha}","${l.hora}","${l.device}","${estadoTexto}","${l.details || ''}"\n`;
  });
  downloadCSV(csv, `bitacora_cte_${new Date().toISOString().slice(0,19)}.csv`);
}

function downloadCSV(csv, filename) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ==================== ARCHIVOS ====================
// Archivos fijos (FILES_BASE) + archivos que agrega el admin (colección "archivos" en Firestore)
let FILES_REMOTE = [];
function getFiles(){ return [...FILES_BASE, ...FILES_REMOTE]; }

function listenToArchivos(){
  if (archivosUnsubscribe) archivosUnsubscribe();
  archivosUnsubscribe = db.collection('archivos').onSnapshot((snap) => {
    FILES_REMOTE = [];
    snap.forEach(d => FILES_REMOTE.push(d.data()));
    FILES_REMOTE.sort((a, b) => (a.id || 0) - (b.id || 0));
    renderAllSectionFiles();
    if (currentUser && currentUser.rol === 'admin') renderAdminFiles();
  }, (error) => { console.error('Error escuchando archivos:', error); });
}

// Pasa a Firestore los archivos que el admin había guardado antes solo en su navegador
async function migrarArchivosLocales(){
  try {
    const local = JSON.parse(localStorage.getItem('cte_files') || '[]');
    if (!local.length) return;
    const baseIds = new Set(FILES_BASE.map(f => f.id));
    const pendientes = local.filter(f => f && f.id && !baseIds.has(f.id));
    for (const f of pendientes) {
      await db.collection('archivos').doc(String(f.id)).set(f, { merge: true });
    }
    localStorage.removeItem('cte_files');
    if (pendientes.length) showToast(`📁 ${pendientes.length} ARCHIVO(S) LOCALES PASADOS A LA NUBE`, 'success');
  } catch (e) { console.error('No se pudieron migrar los archivos locales:', e); }
}

function extractDriveId(url){
  const m1 = url.match(/\/d\/([a-zA-Z0-9_-]{15,})/);
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]{15,})/);
  if(m1) return m1[1];
  if(m2) return m2[1];
  return null;
}
function driveViewUrl(url, tipo){
  const id = extractDriveId(url);
  if(!id) return url;
  if(tipo === 'pdf' || tipo === 'img') return 'https://drive.google.com/file/d/' + id + '/view?usp=sharing';
  return 'https://docs.google.com/viewer?url=' + encodeURIComponent('https://drive.google.com/uc?id=' + id);
}
function driveDownloadUrl(url){
  const id = extractDriveId(url);
  if(!id) return url;
  return 'https://drive.google.com/uc?export=download&id=' + id;
}
function verifyDriveLink(url){
  const id = extractDriveId(url);
  if(id) showToast(`ID DE DRIVE DETECTADO: ${id} — ARCHIVO ACCESIBLE`, 'success');
  else showToast('NO SE PUDO EXTRAER EL ID. USA UN ENLACE ESTÁNDAR DE DRIVE.', 'error');
}

// ==================== SESIÓN Y UI ====================
let currentUser = null;
let inactivityTimer;

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => { if (currentUser) doLogout(); }, 30 * 60 * 1000);
}
document.body.addEventListener('click', resetInactivityTimer);
document.body.addEventListener('keypress', resetInactivityTimer);

function entrarAlSistema(found, foto){
  currentUser = found;
  document.getElementById('screen-login').style.display = 'none';
  document.getElementById('screen-main').style.display  = 'block';
  document.getElementById('display-user').textContent = found.nombre + ' (' + found.user + ')';
  const rb = document.getElementById('display-role-badge');
  rb.textContent = found.rol === 'admin' ? 'ADMIN' : 'USUARIO';
  rb.className = 'badge ' + (found.rol==='admin' ? 'badge-admin' : 'badge-user');

  const isAdmin = found.rol === 'admin';
  document.getElementById('nav-admin').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('print-btn').style.display = isAdmin ? 'block' : 'none';

  listenToSelf(userDocId(found));
  listenToArchivos();
  renderDashboard();
  renderAllSectionFiles();
  if (isAdmin) {
    listenToUsers();
    listenToSolicitudes();
    migrarArchivosLocales();
  }
  resetInactivityTimer();
  showToast(`BIENVENIDO, ${found.nombre.split(' ')[0]}`, 'success', 3000);
}

// ==================== AUTENTICACIÓN (Firebase Auth + Google) ====================
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(() => {});

function loginConGoogle(){
  _loginInteractivo = true;
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  auth.signInWithPopup(provider).catch(err => {
    _loginInteractivo = false;
    const c = err && err.code;
    if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return;
    if (c === 'auth/popup-blocked') mostrarError('EL NAVEGADOR BLOQUEÓ LA VENTANA DE GOOGLE. PERMITA LAS VENTANAS EMERGENTES.');
    else if (c === 'auth/unauthorized-domain') mostrarError('ESTE DOMINIO NO ESTÁ AUTORIZADO EN FIREBASE AUTHENTICATION.');
    else { console.error(err); mostrarError('ERROR AL INICIAR SESIÓN CON GOOGLE.'); }
  });
}

// Se ejecuta al iniciar sesión con Google (y al restaurar una sesión abierta en la misma pestaña)
auth.onAuthStateChanged(async (fbUser) => {
  if (!fbUser) return;
  if (currentUser) return;
  const email = String(fbUser.email || '').toLowerCase();
  const interactivo = _loginInteractivo;
  _loginInteractivo = false;
  try {
    const doc = await db.collection('users').doc(email).get();
    if (!doc.exists) {
      if (interactivo) await addLog(email.split('@')[0], fbUser.displayName || 'DESCONOCIDO', 'fail', email, 'CUENTA NO APROBADA');
      mostrarError('❌ NO TIENES UNA CUENTA APROBADA. SOLICITA REGISTRO PRIMERO Y ESPERA LA APROBACIÓN DEL ADMINISTRADOR.');
      await auth.signOut();
      return;
    }
    const user = { id: doc.id, ...doc.data() };
    if (user.blocked === true) {
      if (interactivo) await addLog(user.user, user.nombre, 'fail', email, 'CUENTA BLOQUEADA');
      mostrarError('CUENTA BLOQUEADA. CONTACTE AL ADMINISTRADOR.');
      await auth.signOut();
      return;
    }
    if (interactivo) await addLog(user.user, user.nombre, 'ok', email);
    entrarAlSistema(user, fbUser.photoURL);
  } catch (err) {
    console.error(err);
    mostrarError('NO SE PUDO VALIDAR SU CUENTA. INTENTE NUEVAMENTE.');
    auth.signOut().catch(() => {});
  }
});

function doLogout(){
  detenerListeners();
  clearTimeout(inactivityTimer);
  currentUser = null;
  document.getElementById('screen-main').style.display = 'none';
  document.getElementById('screen-login').style.display = 'flex';
  document.getElementById('nav-admin').style.display = 'none';
  document.getElementById('print-btn').style.display = 'none';
  auth.signOut().catch(() => {});
}

// ==================== RENDERIZADO PRINCIPAL ====================
async function renderDashboard(){
  const isAdmin = currentUser && currentUser.rol === 'admin';
  const logs = isAdmin ? await getLogs() : [];
  const hoy = new Date().toLocaleDateString('es-EC');
  const hoyOk = logs.filter(l=>l.fecha===hoy && l.estado==='ok').length;
  const hoyFail = logs.filter(l=>l.fecha===hoy && l.estado==='fail').length;
  const last = logs.filter(l=>l.estado==='ok')[0];
  if (isAdmin) document.getElementById('stat-total').textContent = USERS.length;
  document.getElementById('stat-hoy').textContent = hoyOk;
  document.getElementById('stat-fail').textContent = hoyFail;
  if(last){ document.getElementById('stat-last').textContent = last.nombre.split(' ')[0]; document.getElementById('stat-last-time').textContent = last.fecha+' '+last.hora; }
  // ── Solo admin ve las tarjetas de estadísticas ──
  document.getElementById('dashboard-stats').style.display = isAdmin ? '' : 'none';
  document.getElementById('dashboard-bitacora').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('dashboard-no-admin').style.display = isAdmin ? 'none' : 'block';
  if(isAdmin){
    const recent = [...logs].slice(0,15);
    document.getElementById('log-count-label').textContent = logs.length+' REGISTROS';
    document.getElementById('log-tbody').innerHTML = recent.map(l=>`<tr><td>${esc(l.usuario)}</td><td>${esc(l.nombre)}</td><td>${esc(l.fecha)} ${esc(l.hora)}</td><td>${esc(l.device)}</td><td><span class="badge ${l.estado==='ok'?'badge-ok':'badge-fail'}">${l.estado==='ok'?'✓ EXITOSO':'✗ FALLIDO'}</span></td></tr>`).join('');
  }
}

async function renderAdmin(){
  if(!currentUser||currentUser.rol!=='admin') return;
  const logs = await getLogs();
  
  await renderSolicitudes();
  await renderBasePersonalInfo();
  
  document.getElementById('admin-users-list').innerHTML = USERS.map(u => {
    const isSelf = u.user === currentUser.user;
    const isAdm  = u.rol === 'admin';
    const datosExtra = u.area ? `<br><span style="font-size:.7rem">📍 ${esc(u.area)}${u.grado ? ' | ' + esc(u.grado) : ''} | CÓD: ${esc(u.codigo)}</span>` : '';

    const btnBlock = (!isSelf && !isAdm)
      ? (u.blocked
          ? `<button class="btn-unblock" onclick="toggleBlockUser('${u.user}',false)" title="Desbloquear">✓ DESBLOQUEAR</button>`
          : `<button class="btn-block"   onclick="toggleBlockUser('${u.user}',true)"  title="Bloquear">⊘ BLOQUEAR</button>`)
      : '';

    const btnAdmin = !isSelf
      ? (isAdm
          ? `<button class="btn-block"   onclick="toggleAdminRole('${u.user}')" title="Quitar admin">👤 QUITAR ADMIN</button>`
          : `<button class="btn-unblock" onclick="toggleAdminRole('${u.user}')" title="Hacer admin">🛡 HACER ADMIN</button>`)
      : '';

    const btnDel = (!isSelf && !isAdm)
      ? `<button class="btn-block" style="background:var(--danger,#c0392b);color:#fff" onclick="deleteUser('${u.user}')" title="Eliminar">🗑 ELIMINAR</button>`
      : '';

    return `
      <div class="user-row">
        <div class="avatar">${esc(u.nombre.split(' ').map(x=>x[0]).slice(0,2).join(''))}</div>
        <div class="user-info">
          <strong>${esc(u.nombre)}${u.blocked ? '<span class="blocked-badge">● BLOQUEADO</span>' : ''}</strong>
          <span>${esc(u.user)} · <span class="badge ${isAdm?'badge-admin':'badge-user'}">${u.rol}</span> · 📧 ${esc(u.email || 'SIN CORREO')}${datosExtra}</span>
        </div>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center">
          ${btnBlock}${btnAdmin}${btnDel}
        </div>
      </div>`;
  }).join('');
  
  const byUser={};
  USERS.forEach(u=>{ byUser[u.user]={ok:0,fail:0,last:'NUNCA'}; });
  logs.forEach(l=>{ if(byUser[l.usuario]) { if(l.estado==='ok'){ byUser[l.usuario].ok++; byUser[l.usuario].last=l.fecha+' '+l.hora; } else if(l.estado==='fail') byUser[l.usuario].fail++; } });
  document.getElementById('admin-stats').innerHTML = USERS.map(u=>`<div style="padding:.5rem 0;border-bottom:1px solid #f0f2f6"><strong>${esc(u.nombre)}</strong><br><span>INGRESOS: <strong style="color:var(--success)">${byUser[u.user]?.ok||0}</strong> · FALLIDOS: <strong style="color:var(--danger)">${byUser[u.user]?.fail||0}</strong></span><br><span style="font-size:.73rem">ÚLTIMO: ${byUser[u.user]?.last}</span></div>`).join('');
  
  const all=[...logs];
  document.getElementById('admin-log-total').textContent = all.length;
  renderLogPage(all, 1);
  renderChart(logs);
  renderAdminFiles();
}

let _allLogs = [], _logPage = 1;
const LOG_PAGE_SIZE = 15;
function renderLogPage(logs, page){
  _allLogs = logs; _logPage = page;
  const total = logs.length;
  const pages = Math.ceil(total / LOG_PAGE_SIZE) || 1;
  const start = (page-1)*LOG_PAGE_SIZE;
  const slice = logs.slice(start, start+LOG_PAGE_SIZE);
  document.getElementById('admin-log-tbody').innerHTML = slice.map(l=>`<tr><td>${esc(l.usuario)}</td><td>${esc(l.nombre)}</td><td>${esc(l.fecha)} ${esc(l.hora)}</td><td>${esc(l.device)}</td><td><span class="badge ${l.estado==='ok'?'badge-ok':(l.estado==='aprobacion'?'badge-admin':'badge-fail')}">${l.estado==='ok'?'✓ EXITOSO':(l.estado==='aprobacion'?'✅ APROBACIÓN':'✗ FALLIDO')}</span>${l.details?`<br><small>${esc(l.details)}</small>`:''}</td></tr>`).join('');
  const pag = document.getElementById('log-pagination');
  if(pages <= 1){ pag.innerHTML=''; return; }
  let btns = '';
  if(page>1) btns += `<button class="page-btn" onclick="renderLogPage(_allLogs,${page-1})">‹</button>`;
  for(let p=Math.max(1,page-2);p<=Math.min(pages,page+2);p++)
    btns += `<button class="page-btn${p===page?' active':''}" onclick="renderLogPage(_allLogs,${p})">${p}</button>`;
  if(page<pages) btns += `<button class="page-btn" onclick="renderLogPage(_allLogs,${page+1})">›</button>`;
  btns += `<span class="page-info">PÁGINA ${page} DE ${pages} · ${total} REGISTROS</span>`;
  pag.innerHTML = btns;
}

let _accesosChart = null;
function renderChart(logs){
  const days = 14, labels = [], okC = [], failC = [];
  for(let i=days-1;i>=0;i--){
    const d = new Date(); d.setDate(d.getDate()-i);
    const label = d.toLocaleDateString('es-EC');
    const short = d.toLocaleDateString('es-EC',{day:'2-digit',month:'2-digit'});
    labels.push(short);
    const dayLogs = logs.filter(l=>l.fecha===label);
    okC.push(dayLogs.filter(l=>l.estado==='ok').length);
    failC.push(dayLogs.filter(l=>l.estado==='fail').length);
  }
  const canvas = document.getElementById('accesos-chart');
  if(!canvas) return;
  if(_accesosChart){ _accesosChart.destroy(); }
  const isDark = document.body.classList.contains('dark-mode');
  const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
  const tickColor = isDark ? '#9ca3af' : '#5a6278';
  _accesosChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label:'EXITOSOS', data:okC, backgroundColor:'rgba(26,122,74,0.8)', borderColor:'#1a7a4a', borderWidth:1, borderRadius:3 },
        { label:'FALLIDOS', data:failC, backgroundColor:'rgba(192,57,43,0.8)', borderColor:'#c0392b', borderWidth:1, borderRadius:3 }
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:true,
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ title:t=>t[0].label, label:c=>`${c.dataset.label}: ${c.parsed.y}` } } },
      scales:{
        x:{ grid:{color:gridColor}, ticks:{color:tickColor, font:{size:10}} },
        y:{ beginAtZero:true, grid:{color:gridColor}, ticks:{color:tickColor, stepSize:1, font:{size:10}} }
      }
    }
  });
}

// ==================== ARCHIVOS UI ====================
const SECCIONES = { organico:'ORGÁNICO', orden:'ORDEN DEL CUERPO', parametros:'PARÁMETROS', reportes:'REPORTES', historia:'HISTORIA' };
const TIPO_ICONS = { pdf:'📄', word:'📝', excel:'📊', img:'🖼️', other:'📎' };
const TIPO_CSS = { pdf:'file-type-pdf', word:'file-type-word', excel:'file-type-excel', img:'file-type-img', other:'file-type-other' };

function renderSectionFiles(seccion){
  const toolbar = document.getElementById('files-toolbar-'+seccion);
  const grid = document.getElementById('files-grid-'+seccion);
  if(!toolbar) return;
  const isAdmin = currentUser && currentUser.rol==='admin';
  toolbar.innerHTML = `<div class="files-toolbar"><input class="files-search" type="text" placeholder="BUSCAR..." oninput="filterFiles('${seccion}',this.value)"/>${isAdmin ? `<button class="btn-add-file" onclick="showTab('admin');document.getElementById('af-seccion').value='${seccion}'">➕ AGREGAR</button>` : ''}</div>`;
  const files = getFiles().filter(f=>f.seccion===seccion);
  renderFilesGrid(grid, files);
}
function filterFiles(seccion, q){
  const files = getFiles().filter(f=>f.seccion===seccion && (f.nombre.toLowerCase().includes(q.toLowerCase()) || (f.desc||'').toLowerCase().includes(q.toLowerCase())));
  renderFilesGrid(document.getElementById('files-grid-'+seccion), files);
}
function renderFilesGrid(el, files){
  if(!el) return;
  if(!files.length){ el.innerHTML = `<div class="file-empty">📁 NO HAY ARCHIVOS EN ESTA SECCIÓN.</div>`; return; }
  el.innerHTML = `<div class="files-grid">${files.map(f=>{
    const viewUrl = driveViewUrl(f.urlOriginal, f.tipo);
    const dlUrl = driveDownloadUrl(f.urlOriginal);
    return `<div class="file-card"><div class="file-card-top"><div class="file-type-icon ${TIPO_CSS[f.tipo]}">${TIPO_ICONS[f.tipo]}</div><div><div class="file-card-name">${esc(f.nombre)}</div><div class="file-card-meta">${f.desc?esc(f.desc)+'<br>':''}${esc(f.fecha)}</div></div></div><div class="file-card-actions"><a class="file-card-btn file-card-btn-open" href="${viewUrl}" target="_blank">👁️ VER</a><a class="file-card-btn file-card-btn-open" href="${dlUrl}" target="_blank">⬇️ BAJAR</a>${currentUser?.rol==='admin' ? `<button class="file-card-btn file-card-btn-del" onclick="deleteFile(${f.id})">🗑</button>` : ''}</div></div>`;
  }).join('')}</div>`;
}
function renderAllSectionFiles(){ Object.keys(SECCIONES).forEach(s=>renderSectionFiles(s)); }
function renderAdminFiles(){
  const files = getFiles();
  if(!files.length){ document.getElementById('admin-files-list').innerHTML = '<div class="file-empty">SIN ARCHIVOS.</div>'; return; }
  const bySection = {};
  files.forEach(f=>{ if(!bySection[f.seccion]) bySection[f.seccion]=[]; bySection[f.seccion].push(f); });
  document.getElementById('admin-files-list').innerHTML = Object.keys(bySection).map(s=>`<div style="margin-bottom:1rem"><div class="section-badge" style="margin-bottom:.5rem">${SECCIONES[s]||s}</div><div class="files-grid">${bySection[s].map(f=>`<div class="file-card"><div class="file-card-top"><div class="file-type-icon ${TIPO_CSS[f.tipo]}">${TIPO_ICONS[f.tipo]}</div><div><div class="file-card-name">${esc(f.nombre)}</div><div class="file-card-meta">${esc(f.fecha)}</div></div></div><div class="file-card-actions"><button class="file-card-btn file-card-btn-del" onclick="deleteFile(${f.id})">🗑 ELIMINAR</button></div></div>`).join('')}</div></div>`).join('');
}
function deleteFile(id){
  const file = getFiles().find(f=>f.id===id);
  if (!file) return;
  if (FILES_BASE.some(f=>f.id===id)) {
    showToast('ESTE ARCHIVO ESTÁ FIJO EN EL CÓDIGO (FILES_BASE) Y NO SE ELIMINA DESDE AQUÍ.', 'error');
    return;
  }
  openModal('ELIMINAR ARCHIVO', `¿ELIMINAR "${file.nombre}"?`, async ()=>{
    try {
      await db.collection('archivos').doc(String(id)).delete();
      showToast('ARCHIVO ELIMINADO', 'success');
    } catch (e) {
      console.error(e);
      showToast('NO SE PUDO ELIMINAR EL ARCHIVO', 'error');
    }
  });
}
async function addFile(){
  if (!currentUser || currentUser.rol !== 'admin') return;
  const nombre = document.getElementById('af-nombre').value.trim().toUpperCase();
  const seccion = document.getElementById('af-seccion').value;
  const url = document.getElementById('af-url').value.trim();
  const tipo = document.getElementById('af-tipo').value;
  const desc = document.getElementById('af-desc').value.trim().toUpperCase();
  if(!nombre || !url){ showToast('COMPLETA NOMBRE Y ENLACE.', 'error'); return; }
  if(!/^https?:\/\//i.test(url)){ showToast('EL ENLACE DEBE COMENZAR CON HTTP:// O HTTPS://', 'error'); return; }
  const newId = Date.now();
  const fecha = new Date().toLocaleDateString('es-EC');
  const entry = { id:newId, nombre, seccion, urlOriginal: url, tipo, desc, fecha, subidoPor: currentUser ? currentUser.nombre : 'ADMIN' };
  try {
    await db.collection('archivos').doc(String(newId)).set(entry);
  } catch (e) {
    console.error(e);
    showToast('NO SE PUDO GUARDAR EL ARCHIVO', 'error');
    return;
  }
  document.getElementById('af-nombre').value = '';
  document.getElementById('af-url').value = '';
  document.getElementById('af-desc').value = '';
  showToast('✅ ARCHIVO AGREGADO Y VISIBLE PARA TODOS LOS USUARIOS', 'success');
}

function globalSearchFiles(){
  const query = document.getElementById('global-search-input').value.toLowerCase();
  if(!query) { document.getElementById('global-search-results').innerHTML = ''; return; }
  const files = getFiles().filter(f=>f.nombre.toLowerCase().includes(query) || (f.desc||'').toLowerCase().includes(query));
  if(!files.length) { document.getElementById('global-search-results').innerHTML = '<div class="file-empty">NO SE ENCONTRARON ARCHIVOS.</div>'; return; }
  document.getElementById('global-search-results').innerHTML = `<div class="files-grid">${files.map(f=>`<div class="file-card"><div class="file-card-top"><div class="file-type-icon ${TIPO_CSS[f.tipo]}">${TIPO_ICONS[f.tipo]}</div><div><div class="file-card-name">${esc(f.nombre)}</div><div class="file-card-meta">${SECCIONES[f.seccion]} · ${f.fecha}</div></div></div><div class="file-card-actions"><a class="file-card-btn file-card-btn-open" href="${driveViewUrl(f.urlOriginal, f.tipo)}" target="_blank">VER</a></div></div>`).join('')}</div>`;
}

// ==================== EXTRAS ====================
async function exportLogsToCSV(){
  const logs = await getLogs();
  let csv = "USUARIO,NOMBRE,EMAIL,FECHA,HORA,DISPOSITIVO,ESTADO\n";
  logs.forEach(l=>{ csv += `"${l.usuario}","${l.nombre}","${l.email||''}","${l.fecha}","${l.hora}","${l.device}","${l.estado}"\n`; });
  downloadCSV(csv, `bitacora_cte_${new Date().toISOString().slice(0,19)}.csv`);
}
function printCurrentView(){
  const tab = document.querySelector('.tab.active');
  const win = window.open('', '_blank');
  win.document.write(`<html><head><title>REPORTE CTE</title><link href="https://fonts.googleapis.com/css2?family=Source+Sans+3&display=swap" rel="stylesheet"/><style>body{font-family:'Source Sans 3';padding:2rem;}</style></head><body>${tab.innerHTML}</body></html>`);
  win.document.close(); win.print();
}
function toggleDarkMode(){
  document.body.classList.toggle('dark-mode');
  const isDark = document.body.classList.contains('dark-mode');
  localStorage.setItem('darkMode', isDark);
  updateThemeIcon(isDark);
  if(_accesosChart && currentUser && currentUser.rol === 'admin') getLogs().then(renderChart);
}
function updateThemeIcon(isDark){
  const btn = document.getElementById('btn-theme-toggle');
  if(btn) btn.textContent = isDark ? '☀️' : '🌙';
}

async function confirmClearLogs(){
  openModal('🗑 BORRAR BITÁCORA', '¿ELIMINAR TODOS LOS REGISTROS?', async ()=>{ 
    const snapshot = await db.collection('logs').get();
    const batch = db.batch();
    snapshot.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    renderDashboard(); 
    if(currentUser && currentUser.rol === 'admin') { renderAdmin(); } 
  });
}

// ==================== MODAL Y UTILS ====================
let _modalCallback = null;
function openModal(title, msg, onConfirm){
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-msg').textContent = msg;
  _modalCallback = onConfirm;
  document.getElementById('confirm-modal').classList.add('open');
}
function closeModal(){ document.getElementById('confirm-modal').classList.remove('open'); _modalCallback = null; }
document.getElementById('modal-ok-btn').onclick = () => { if(_modalCallback) _modalCallback(); closeModal(); };
document.getElementById('confirm-modal').addEventListener('click', e=>{ if(e.target === e.currentTarget) closeModal(); });
function mostrarError(msg){ const el = document.getElementById('login-error'); el.textContent = msg; el.style.display = 'block'; showToast(msg,'error'); setTimeout(()=>el.style.display='none', 5000); }
function mostrarExito(msg){ const el = document.getElementById('login-success'); el.textContent = msg; el.style.display = 'block'; showToast(msg,'success'); setTimeout(()=>el.style.display='none', 5000); }
function showTab(id){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('tab-'+id).classList.add('active');
  document.querySelectorAll('nav a').forEach(a=>a.classList.remove('active'));
  const lnk = [...document.querySelectorAll('nav a')].find(a=>a.getAttribute('onclick')===`showTab('${id}')`);
  if(lnk) lnk.classList.add('active');
  if(id === 'admin' && currentUser && currentUser.rol === 'admin') renderAdmin();
  if(SECCIONES[id]) renderSectionFiles(id);
}
function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ==================== INICIALIZACIÓN ====================
(function init(){
  const savedDark = localStorage.getItem('darkMode') === 'true';
  if(savedDark){ document.body.classList.add('dark-mode'); }
  updateThemeIcon(savedDark);
  renderAllSectionFiles();
})();
