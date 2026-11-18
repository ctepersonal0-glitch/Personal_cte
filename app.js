// ==================== CONFIGURACIÓN INICIAL ====================
const GOOGLE_CLIENT_ID = '571154981190-e83q5clu440b0p8jqikrqkq3r6v2qrdt.apps.googleusercontent.com';

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

// ==================== LOGIN CON USUARIO/CONTRASEÑA ====================
async function doLoginPass(){
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  if(!user||!pass){ mostrarError('INGRESA USUARIO Y CONTRASEÑA'); return; }
  const found = USERS.find(u=>u.user===user);
  if(!found){ mostrarError('USUARIO NO ENCONTRADO'); addLog(user,'DESCONOCIDO','fail'); return; }
  if(isBlocked(found)){ mostrarError('CUENTA BLOQUEADA. CONTACTE AL ADMINISTRADOR.'); addLog(user,found.nombre,'fail'); return; }
  const hashed = await hashPass(pass);
  if(hashed !== found.passHash){ mostrarError('CONTRASEÑA INCORRECTA'); addLog(user,found.nombre,'fail'); return; }
  addLog(found.user,found.nombre,'ok',found.email||'');
  entrarAlSistema(found, null);
}

// Usuarios por defecto (solo admin)
const DEFAULT_USERS = [
  { user:'admin', passHash:'', nombre:'ADMINISTRADOR SISTEMA', rol:'admin', email:'ctepersonal0@gmail.com', blocked: false, area:'', codigo:'', grado:'' },
];

const FILES_BASE = [
  { id:1779224557782, nombre:'HISTORIAL CTE', seccion:'organico', tipo:'excel', desc:'', fecha:'19/05/2026', urlOriginal:'https://drive.google.com/drive/folders/1IKszLxBRMZTpv0CyJYaFJ11KbmaftAlW?usp=sharing' },
  { id:1780069150402, nombre:'ORGANICO', seccion:'organico', tipo:'excel', desc:'', fecha:'29/5/2026', urlOriginal:'https://drive.google.com/drive/folders/1aiqSt2DEzT7_LTuEVcy19J-Y3_-iRihN?usp=drive_link' },
  { id:1780069566182, nombre:'LISTADO PARAMETROS 2026', seccion:'parametros', tipo:'excel', desc:'', fecha:'29/5/2026', urlOriginal:'https://drive.google.com/drive/folders/1XPel3aDUBnMdyCMTGpBhIW0GPP98F5dh?usp=drive_link' },
  { id:1780070483456, nombre:'ORDEN DEL CUERPO 2026', seccion:'orden', tipo:'pdf', desc:'', fecha:'29/5/2026', urlOriginal:'https://drive.google.com/drive/folders/1Np2lvD-Rlgxkkq9_OGPIrlJAHrRyiE3M?usp=drive_link' },
];

// ==================== FUNCIONES DE HASH ====================
async function hashPass(pass) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pass);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ==================== FIRESTORE CONFIGURACIÓN ====================
let USERS = [];
let _usersHuerfanos = [];
let _docIdsPorUser = {};
let _rolReciente = null;
const APP_VERSION = 'v6.1';
console.info('Personal CTE', APP_VERSION);
let solicitudesUnsubscribe = null;

// Cargar usuarios desde Firestore con escucha en tiempo real
async function initializeUsers() {
  showToast('Conectando a la nube...', 'info', 2000);
  
  db.collection('users').onSnapshot(async (snapshot) => {
    // Un usuario = un documento. Si hay duplicados (mismo campo "user"), se conserva
    // el documento cuyo id coincide con el usuario y los demás se ignoran (NO se borran de Firestore).
    const porUser = {};
    _usersHuerfanos = [];
    _docIdsPorUser = {};
    snapshot.forEach(doc => {
      const data = doc.data();
      const key = data.user || doc.id;
      (_docIdsPorUser[key] = _docIdsPorUser[key] || []).push(doc.id);
      const entry = { id: doc.id, ...data };
      const actual = porUser[key];
      if (!actual) porUser[key] = entry;
      else if (doc.id === key && actual.id !== key) { _usersHuerfanos.push(actual.id); porUser[key] = entry; }
      else _usersHuerfanos.push(doc.id);
    });
    const usersFromFirestore = Object.values(porUser);
    if (_rolReciente && Date.now() - _rolReciente.t < 120000) {
      const x = porUser[_rolReciente.user];
      if (x && x.rol !== _rolReciente.rol) {
        console.warn('ROL REVERTIDO EN SERVIDOR', _rolReciente, x, 'docs:', _docIdsPorUser[_rolReciente.user]);
        showToast(`⚠️ EL ROL DE ${_rolReciente.user} FUE REVERTIDO A "${x.rol}" EN EL SERVIDOR POR OTRO PROCESO (doc: ${x.id})`, 'error', 12000);
        _rolReciente = null;
      }
    }
    
    if (usersFromFirestore.length > 0) {
      USERS = usersFromFirestore;
      localStorage.setItem('cte_users_cache', JSON.stringify(USERS));
      
      for (let u of USERS) {
        if (!u.passHash) {
          const defaultPass = u.user === 'admin' ? '@dmin2026' : 'cte2026';
          u.passHash = await hashPass(defaultPass);
          try { await saveUserFields(u.user, { passHash: u.passHash }); } catch (e) { console.error('No se pudo guardar clave inicial de', u.user, e); }
        }
      }
      
      if (_usersHuerfanos.length) console.warn('Documentos de usuarios duplicados ignorados (no se borran):', _usersHuerfanos);
      sincronizarSesion();
      if (puedeVerPanel()) renderAdmin();
      if (currentUser) {
        document.getElementById('stat-total').textContent = USERS.length;
      }
    } else if (USERS.length === 0) {
      USERS = JSON.parse(JSON.stringify(DEFAULT_USERS));
      for (let u of USERS) {
        if (!u.passHash) {
          const defaultPass = u.user === 'admin' ? '@dmin2026' : 'cte2026';
          u.passHash = await hashPass(defaultPass);
        }
      }
      await saveUsers();
    }
  }, (error) => {
    console.error('Error escuchando usuarios:', error);
    const cache = localStorage.getItem('cte_users_cache');
    if (cache) USERS = JSON.parse(cache);
    else USERS = JSON.parse(JSON.stringify(DEFAULT_USERS));
  });
}

async function saveUsers() {
  for (let user of USERS) {
    const userData = { ...user };
    delete userData.id;
    await db.collection('users').doc(user.user).set(userData, { merge: true });
  }
  localStorage.setItem('cte_users_cache', JSON.stringify(USERS));
}

// Guarda solo los campos indicados de UN usuario (evita reescribir toda la lista)
async function saveUserFields(username, campos) {
  // Se escribe en TODOS los documentos que representan a este usuario (id = usuario, id = correo, etc.)
  // para que, sin importar cuál se lea, el valor sea el mismo.
  const ids = new Set(_docIdsPorUser[username] && _docIdsPorUser[username].length ? _docIdsPorUser[username] : [username]);
  await Promise.all([...ids].map(id => db.collection('users').doc(id).set(campos, { merge: true })));
  localStorage.setItem('cte_users_cache', JSON.stringify(USERS));
}

function getUserByEmail(email) {
  return USERS.find(u => u.email && u.email.toLowerCase() === email.toLowerCase());
}

function isBlocked(userObj) {
  return userObj.blocked === true;
}

// ==================== ROLES Y PERMISOS ====================
// Roles: admin (todo), supervisor (todo en solo lectura), user (INICIO, ORDEN, VACACIONES + botones que el admin habilite)
const TABS_BASE = ['inicio', 'orden', 'vacaciones'];
const TABS_OPCIONALES = { organico: 'ORGÁNICO', parametros: 'PARÁMETROS', reportes: 'REPORTES' };
const ROL_LABEL = { admin: 'ADMINISTRADOR', supervisor: 'SUPERVISOR', user: 'USUARIO' };

function esAdmin() { return !!currentUser && currentUser.rol === 'admin'; }
function esSupervisor() { return !!currentUser && currentUser.rol === 'supervisor'; }
function puedeVerPanel() { return esAdmin() || esSupervisor(); }
function tabPermitida(id) {
  if (!currentUser) return false;
  if (puedeVerPanel()) return true;
  if (id === 'admin' || id === 'auditoria') return false;
  if (TABS_BASE.includes(id)) return true;
  return Array.isArray(currentUser.tabs) && currentUser.tabs.includes(id);
}
function soloAdmin() {
  if (!esAdmin()) { showToast('ESTA ACCIÓN ES SOLO PARA EL ADMINISTRADOR', 'error'); return false; }
  return true;
}

function aplicarSesionUI() {
  if (!currentUser) return;
  const rb = document.getElementById('display-role-badge');
  rb.textContent = esAdmin() ? 'ADMIN' : (esSupervisor() ? 'SUPERVISOR' : 'USUARIO');
  rb.className = 'badge ' + (esAdmin() ? 'badge-admin' : (esSupervisor() ? 'badge-supervisor' : 'badge-user'));
  document.getElementById('print-btn').style.display = puedeVerPanel() ? 'block' : 'none';
  document.body.classList.toggle('rol-supervisor', esSupervisor());
  document.body.classList.toggle('rol-admin', esAdmin());
  const idDe = el => { const m = (el.getAttribute('onclick') || '').match(/showTab\('(\w+)'\)/); return m ? m[1] : null; };
  document.querySelectorAll('nav a').forEach(a => { const id = idDe(a); if (id) a.style.display = tabPermitida(id) ? '' : 'none'; });
  document.querySelectorAll('.grid .card[onclick]').forEach(c => { const id = idDe(c); if (id) c.style.display = tabPermitida(id) ? '' : 'none'; });
}

// Mantiene la sesión al día si el administrador cambia el rol, los botones o bloquea la cuenta
function sincronizarSesion() {
  if (!currentUser) return;
  const me = USERS.find(u => u.user === currentUser.user);
  if (!me) return;
  if (me.blocked) { showToast('SU CUENTA FUE BLOQUEADA', 'error'); doLogout(); return; }
  const cambio = me.rol !== currentUser.rol || JSON.stringify(me.tabs || []) !== JSON.stringify(currentUser.tabs || []);
  currentUser.rol = me.rol;
  currentUser.tabs = me.tabs;
  if (cambio) {
    aplicarSesionUI();
    const act = document.querySelector('.tab.active');
    if (act && !tabPermitida(act.id.replace('tab-', ''))) showTab('inicio', true);
  }
}

function toggleBlockUser(username, block) {
  if (!soloAdmin()) return;
  const user = USERS.find(u => u.user === username);
  if (!user || user.rol === 'admin') return;
  user.blocked = block;
  saveUserFields(user.user, { blocked: block });
  auditar('ACCION_ADMIN', `${block ? 'BLOQUEÓ' : 'DESBLOQUEÓ'} AL USUARIO ${user.user}`);
  if (currentUser && currentUser.rol === 'admin') {
    renderAdmin();
  }
}

// ==================== ACCIONES INLINE DE USUARIOS ====================

async function deleteUser(username) {
  if (!soloAdmin()) return;
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
      batch.delete(db.collection('users').doc(username));

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
      }

      await batch.commit();

      // 4. Limpiar del array local y caché
      USERS = USERS.filter(u => u.user !== username);
      localStorage.setItem('cte_users_cache', JSON.stringify(USERS));
      auditar('ACCION_ADMIN', `ELIMINÓ AL USUARIO ${username}`);

      renderAdmin();
      showToast(`USUARIO ${user.nombre} ELIMINADO COMPLETAMENTE`, 'success');

    } catch (err) {
      console.error('Error al eliminar usuario:', err);
      showToast('ERROR AL ELIMINAR. REVISA LA CONSOLA.', 'error');
    }
  });
}
async function cambiarRol(username, nuevoRol) {
  if (!soloAdmin()) return;
  const user = USERS.find(u => u.user === username);
  if (!user || user.user === currentUser.user) { showToast('NO PUEDES MODIFICAR TU PROPIO ROL', 'error'); return; }
  if (!ROL_LABEL[nuevoRol]) return;
  openModal('CAMBIAR ROL', `¿CAMBIAR ROL DE ${user.nombre} A ${ROL_LABEL[nuevoRol]}?`, async () => {
    const anterior = user.rol;
    user.rol = nuevoRol;
    try {
      await saveUserFields(user.user, { rol: nuevoRol });
    } catch (err) {
      console.error('Error guardando rol:', err);
      user.rol = anterior;
      renderAdmin();
      showToast('NO SE PUDO GUARDAR EL ROL: ' + (err && err.message ? err.message : 'ERROR'), 'error', 6000);
      return;
    }
    // Verificación: leer de nuevo desde el servidor
    try {
      const ids = _docIdsPorUser[user.user] && _docIdsPorUser[user.user].length ? _docIdsPorUser[user.user] : [user.user];
      const lecturas = await Promise.all(ids.map(id => db.collection('users').doc(id).get({ source: 'server' })));
      const malos = lecturas.filter(d => !d.exists || d.data().rol !== nuevoRol).map(d => d.id);
      if (malos.length) {
        showToast(`⚠️ EL SERVIDOR NO CONSERVÓ EL ROL (doc: ${malos.join(', ')})`, 'error', 10000);
      } else {
        _rolReciente = { user: user.user, rol: nuevoRol, t: Date.now() };
        console.info(APP_VERSION, 'rol verificado en servidor, docs:', ids);
      }
    } catch (e) { console.warn('verificación', e); }
    auditar('ACCION_ADMIN', `CAMBIÓ EL ROL DE ${user.user}: ${ROL_LABEL[anterior] || anterior} → ${ROL_LABEL[nuevoRol]}`);
    renderAdmin();
    showToast(`ROL DE ${user.nombre} CAMBIADO A ${ROL_LABEL[nuevoRol]} (${APP_VERSION})`, 'success');
  });
}
function toggleAdminRole(username) {
  const u = USERS.find(x => x.user === username);
  if (u) cambiarRol(username, u.rol === 'admin' ? 'user' : 'admin');
}

// Botones adicionales (ORGÁNICO, PARÁMETROS, REPORTES) que el administrador habilita a un usuario
async function toggleTabUsuario(username, tab, activo) {
  if (!soloAdmin()) return;
  const user = USERS.find(u => u.user === username);
  if (!user || !TABS_OPCIONALES[tab]) return;
  const tabsAnterior = user.tabs;
  const set = new Set(user.tabs || []);
  if (activo) set.add(tab); else set.delete(tab);
  user.tabs = [...set];
  try {
    await saveUserFields(user.user, { tabs: user.tabs });
    auditar('ACCION_ADMIN', `${activo ? 'HABILITÓ' : 'QUITÓ'} EL BOTÓN ${TABS_OPCIONALES[tab]} A ${user.user}`);
    showToast(`${activo ? 'HABILITADO' : 'QUITADO'}: ${TABS_OPCIONALES[tab]}`, 'success', 2000);
  } catch (err) {
    console.error(err);
    user.tabs = tabsAnterior;
    renderAdmin();
    showToast('NO SE PUDO GUARDAR EL CAMBIO: ' + (err && err.message ? err.message : 'ERROR'), 'error', 6000);
  }
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
      
      if (puedeVerPanel()) {
        renderSolicitudes();
        if (document.getElementById('tab-auditoria').classList.contains('active')) renderAuditoriaResumen();
        
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

let _regAgente = null;
let _regBuscarTimer = null;

function normalizarCodigo(v){
  return String(v || '').replace(/[^0-9]/g, '').replace(/^0+/, '');
}

function limpiarAgenteRegistro(msg, tipo){
  _regAgente = null;
  const area = document.getElementById('reg-area');
  if (area) area.value = '';
  const el = document.getElementById('reg-codigo-msg');
  if (el) {
    el.textContent = msg || '';
    el.style.color = tipo === 'error' ? '#c0392b' : (tipo === 'ok' ? '#1a7a4a' : '#8899aa');
  }
}

function buscarAgentePorCodigo(){
  clearTimeout(_regBuscarTimer);
  const codigo = normalizarCodigo(document.getElementById('reg-codigo').value);

  if (codigo.length < 4) {
    limpiarAgenteRegistro(codigo ? 'INGRESE EL CÓDIGO COMPLETO (4 O 5 DÍGITOS)' : '');
    return;
  }

  limpiarAgenteRegistro('BUSCANDO CÓDIGO...');

  _regBuscarTimer = setTimeout(async () => {
    try {
      const doc = await db.collection(BASE_PERSONAL_COL).doc(codigo).get();

      if (!doc.exists) {
        limpiarAgenteRegistro('❌ CÓDIGO NO REGISTRADO EN LA BASE DE PERSONAL', 'error');
        return;
      }

      const d = doc.data();
      _regAgente = {
        codigo: codigo,
        grado: d.grado || '',
        apellidos: d.apellidos || '',
        nombres: d.nombres || '',
        area: d.area || ''
      };
      _regAgente.nombreAgente = `${_regAgente.apellidos} ${_regAgente.nombres}`.trim();

      const inputArea = document.getElementById('reg-area');
      if (inputArea) inputArea.value = _regAgente.area;

      const el = document.getElementById('reg-codigo-msg');
      if (el) {
        el.textContent = `✔ ${_regAgente.grado} ${_regAgente.nombreAgente}`.trim();
        el.style.color = '#1a7a4a';
      }
    } catch (err) {
      console.error('Error consultando base de personal:', err);
      limpiarAgenteRegistro('⚠ NO SE PUDO CONSULTAR LA BASE. INTENTE NUEVAMENTE.', 'error');
    }
  }, 350);
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
async function solicitarRegistro() {
  const codigo = normalizarCodigo(document.getElementById('reg-codigo').value);
  const email = document.getElementById('reg-email').value.trim().toLowerCase();

  if (!codigo || !email) {
    mostrarError('INGRESA EL CÓDIGO INSTITUCIONAL Y EL CORREO');
    return;
  }

  if (!_regAgente || _regAgente.codigo !== codigo) {
    mostrarError('CÓDIGO NO REGISTRADO EN LA BASE DE PERSONAL. VERIFÍCALO O CONTACTA AL ADMINISTRADOR.');
    return;
  }

  const area = _regAgente.area;

  if (!email.endsWith('@gmail.com')) {
    mostrarError('SOLO SE PERMITEN CORREOS DE GMAIL');
    return;
  }

  const usuarioExistente = getUserByEmail(email);
  if (usuarioExistente) {
    const nombre = usuarioExistente.nombre || email;
    mostrarError(
      `⚠️ EL CORREO ${email.toUpperCase()} YA ESTÁ REGISTRADO COMO "${nombre}". INICIA SESIÓN CON GOOGLE O CONTACTA AL ADMINISTRADOR.`
    );
    const googleWrap = document.getElementById('google-btn-wrap');
    if (googleWrap) {
      googleWrap.style.outline = '2px solid #e67e22';
      googleWrap.style.borderRadius = '6px';
      setTimeout(() => {
        googleWrap.style.outline = '';
        googleWrap.style.borderRadius = '';
      }, 5000);
    }
    return;
  }

  const aprobadaSnap = await db.collection('solicitudes')
    .where('email', '==', email)
    .where('estado', '==', 'aprobada')
    .get();

  if (!aprobadaSnap.empty) {
    mostrarError(
      `✅ TU SOLICITUD YA FUE APROBADA. INICIA SESIÓN CON GOOGLE USANDO ${email.toUpperCase()}.`
    );
    const googleWrap = document.getElementById('google-btn-wrap');
    if (googleWrap) {
      googleWrap.style.outline = '2px solid #27ae60';
      googleWrap.style.borderRadius = '6px';
      setTimeout(() => {
        googleWrap.style.outline = '';
        googleWrap.style.borderRadius = '';
      }, 5000);
    }
    return;
  }

  const existingSolicitud = await db.collection('solicitudes')
    .where('email', '==', email)
    .where('estado', '==', 'pendiente')
    .get();
  
  if (!existingSolicitud.empty) {
    mostrarError('YA TIENES UNA SOLICITUD PENDIENTE. ESPERA LA APROBACIÓN DEL ADMINISTRADOR.');
    return;
  }

  showToast('ENVIANDO SOLICITUD...', 'info', 2500);

  const nuevaSolicitud = {
    area,
    codigo,
    grado: _regAgente.grado,
    apellidos: _regAgente.apellidos,
    nombres: _regAgente.nombres,
    nombreAgente: _regAgente.nombreAgente,
    email,
    fecha: new Date().toLocaleDateString('es-EC'),
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    estado: 'pendiente'
  };

  await db.collection('solicitudes').add(nuevaSolicitud);

  mostrarExito('✅ SOLICITUD ENVIADA. ESPERA LA APROBACIÓN DEL ADMINISTRADOR PARA PODER INGRESAR.');
  document.getElementById('reg-codigo').value = '';
  document.getElementById('reg-email').value = '';
  limpiarAgenteRegistro();
}

async function aprobarSolicitud(id) {
  if (!soloAdmin()) return;
  const docRef = db.collection('solicitudes').doc(id);
  const doc = await docRef.get();
  
  if (!doc.exists) return;
  
  const solicitud = doc.data();

  const nombreCompleto = solicitud.nombreAgente
    ? `${solicitud.grado ? solicitud.grado + ' ' : ''}${solicitud.nombreAgente}`.trim()
    : `${solicitud.area} (${solicitud.codigo})`;
  const baseUsername = solicitud.email.split('@')[0];
  let username = baseUsername;
  let counter = 1;
  
  while (USERS.find(u => u.user === username)) {
    username = `${baseUsername}${counter}`;
    counter++;
  }

  const nuevoUsuario = {
    user: username,
    passHash: '',
    nombre: nombreCompleto,
    rol: 'user',
    email: solicitud.email,
    blocked: false,
    area: solicitud.area,
    codigo: solicitud.codigo,
    grado: solicitud.grado || '',
    apellidos: solicitud.apellidos || '',
    nombres: solicitud.nombres || '',
    creado: firebase.firestore.FieldValue.serverTimestamp()
  };

  USERS.push(nuevoUsuario);
  { const d = { ...nuevoUsuario }; delete d.id; await db.collection('users').doc(username).set(d, { merge: true }); }
  await docRef.update({ estado: 'aprobada', fechaAprobacion: firebase.firestore.FieldValue.serverTimestamp() });

  addLog(username, nombreCompleto, 'aprobacion', solicitud.email,
    `CUENTA APROBADA POR ADMINISTRADOR - ÁREA: ${solicitud.area}, CÓDIGO: ${solicitud.codigo}`);

  if (currentUser && currentUser.rol === 'admin') renderAdmin();
  showToast(`✅ USUARIO ${nombreCompleto} APROBADO CORRECTAMENTE.`, 'success');
}

async function rechazarSolicitud(id) {
  if (!soloAdmin()) return;
  const docRef = db.collection('solicitudes').doc(id);
  const doc = await docRef.get();
  const solicitud = doc.data();

  openModal('RECHAZAR SOLICITUD', `¿RECHAZAR LA SOLICITUD DE ${solicitud.nombreAgente || solicitud.area} (CÓD. ${solicitud.codigo})?`, async () => {
    await docRef.update({ estado: 'rechazada', fechaRechazo: firebase.firestore.FieldValue.serverTimestamp() });
    auditar('ACCION_ADMIN', `RECHAZÓ LA SOLICITUD DE ${solicitud.nombreAgente || solicitud.area} (CÓD. ${solicitud.codigo})`);
    if (currentUser && currentUser.rol === 'admin') renderAdmin();
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
    console.error('Error leyendo solicitudes:', err);
    container.innerHTML = '<div class="file-empty">⚠️ NO SE PUDIERON CARGAR LAS SOLICITUDES: ' + esc(err && err.message ? err.message : 'ERROR') + '</div>';
    return;
  }

  const solicitudes = [];
  snapshot.forEach(doc => {
    solicitudes.push({ id: doc.id, ...doc.data() });
  });

  solicitudes.sort((a, b) => {
    const ta = a.timestamp ? a.timestamp.seconds : 0;
    const tb = b.timestamp ? b.timestamp.seconds : 0;
    return tb - ta;
  });

  if (solicitudes.length === 0) {
    container.innerHTML = '<div class="file-empty">📭 NO HAY SOLICITUDES PENDIENTES</div>';
    return;
  }

  container.innerHTML = `
    <div class="files-grid">
      ${solicitudes.map(s => `
        <div class="file-card">
          <div class="file-card-top">
            <div class="file-type-icon file-type-other">📧</div>
            <div>
              <div class="file-card-name">${esc(s.nombreAgente || s.area)}</div>
              <div class="file-card-meta">${s.grado ? esc(s.grado) + '<br>' : ''}ÁREA: ${esc(s.area)}<br>CÓDIGO: ${esc(s.codigo)}<br>CORREO: ${esc(s.email)}<br>SOLICITADO: ${s.fecha}</div>
            </div>
          </div>
          ${esAdmin() ? `<div class="file-card-actions">
            <button class="file-card-btn file-card-btn-open btn-approve" onclick="aprobarSolicitud('${s.id}')">✓ APROBAR</button>
            <button class="file-card-btn file-card-btn-del btn-reject" onclick="rechazarSolicitud('${s.id}')">✗ RECHAZAR</button>
          </div>` : ''}
        </div>
      `).join('')}
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
    tipo: estado === 'ok' ? 'LOGIN' : (estado === 'fail' ? 'LOGIN_FALLIDO' : 'ACCION_ADMIN'),
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
  auditar('EXPORTACION', 'EXPORTÓ EL LISTADO DE USUARIOS');
  let csv = "NOMBRE,USUARIO,ROL,EMAIL,GRADO,ÁREA,CÓDIGO INSTITUCIONAL,ESTADO\n";
  USERS.forEach(u => {
    csv += `"${u.nombre}","${u.user}","${ROL_LABEL[u.rol] || 'USUARIO'}","${u.email || ''}","${u.grado || ''}","${u.area || ''}","${u.codigo || ''}","${u.blocked ? 'BLOQUEADO' : 'ACTIVO'}"\n`;
  });
  downloadCSV(csv, `usuarios_cte_${new Date().toISOString().slice(0,19)}.csv`);
}

async function exportLogsToExcel() {
  auditar('EXPORTACION', 'EXPORTÓ LA BITÁCORA DE INGRESOS (CSV)');
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
function getFiles(){
  try{
    const local = JSON.parse(localStorage.getItem('cte_files')||'[]');
    const localIds = new Set(local.map(f=>f.id));
    const base = FILES_BASE.filter(f=>!localIds.has(f.id));
    return [...base, ...local];
  }catch(e){ return [...FILES_BASE]; }
}
function saveFiles(f){
  const baseIds = new Set(FILES_BASE.map(x=>x.id));
  localStorage.setItem('cte_files', JSON.stringify(f.filter(x=>!baseIds.has(x.id))));
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
  inactivityTimer = setTimeout(() => { if (currentUser) doLogout('INACTIVIDAD'); }, 30 * 60 * 1000);
}
document.body.addEventListener('click', resetInactivityTimer);
document.body.addEventListener('keypress', resetInactivityTimer);

function entrarAlSistema(found, foto){
  currentUser = found;
  document.getElementById('screen-login').style.display = 'none';
  document.getElementById('screen-main').style.display  = 'block';
  document.getElementById('display-user').textContent = found.nombre + ' (' + found.user + ')';
  aplicarSesionUI();
  showTab('inicio', true);

  renderDashboard();
  renderAllSectionFiles();
  if (puedeVerPanel()) {
    renderAdmin();
  }
  resetInactivityTimer();
  showToast(`BIENVENIDO, ${found.nombre.split(' ')[0]}`, 'success', 3000);
}

function initGoogle(){
  if(typeof google === 'undefined') { setTimeout(initGoogle, 300); return; }
  google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleToken, ux_mode: 'popup' });
  const wrap = document.getElementById('google-btn-wrap');
  if(wrap){
    google.accounts.id.renderButton(wrap, { theme:'outline', size:'large', width: 320, text:'signin_with', shape:'rectangular', logo_alignment:'left' });
    document.getElementById('btn-google-fallback').style.display = 'none';
  }
}
window.addEventListener('load', initGoogle);

function loginConGoogle(){
  if(typeof google === 'undefined'){ mostrarError('CARGANDO GOOGLE, INTENTA EN UN MOMENTO.'); return; }
  google.accounts.id.prompt(notification => {
    if(notification.isNotDisplayed() || notification.isSkippedMoment()){
      const btn = document.querySelector('#google-btn-wrap div[role=button]');
      if(btn) btn.click();
    }
  });
}

function onGoogleToken(response){
  try{
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    const email = payload.email.toLowerCase();
    const nombre = payload.name;
    const foto = payload.picture;
    
    const user = getUserByEmail(email);
    
    if (!user) {
      mostrarError('❌ NO TIENES UNA CUENTA APROBADA. SOLICITA REGISTRO PRIMERO Y ESPERA LA APROBACIÓN DEL ADMINISTRADOR.');
      return;
    }
    
    if(user.blocked){ 
      mostrarError('CUENTA BLOQUEADA. CONTACTE AL ADMINISTRADOR.'); 
      addLog(user.user, user.nombre, 'fail', email);
      return; 
    }
    
    addLog(user.user, user.nombre, 'ok', email);
    entrarAlSistema(user, foto);
    
  }catch(e){ 
    console.error(e);
    mostrarError('ERROR AL PROCESAR LA RESPUESTA DE GOOGLE.'); 
  }
}

function doLogout(motivo){
  if (currentUser) auditar('LOGOUT', motivo === 'INACTIVIDAD' ? 'SESIÓN CERRADA POR INACTIVIDAD' : 'CERRÓ SESIÓN');
  currentUser = null;
  _ultimaPestana = null;
  document.body.classList.remove('rol-supervisor', 'rol-admin');
  document.getElementById('screen-main').style.display = 'none';
  document.getElementById('screen-login').style.display = 'flex';
  document.getElementById('nav-admin').style.display = 'none';
  document.getElementById('print-btn').style.display = 'none';
}

// ==================== RENDERIZADO PRINCIPAL ====================
async function renderDashboard(){
  // La bitácora de accesos solo existe para administrador y supervisor: el usuario normal no ve ni el título
  const panel = puedeVerPanel();
  document.getElementById('dashboard-stats').style.display = panel ? '' : 'none';
  document.getElementById('dashboard-bitacora-titulo').style.display = panel ? '' : 'none';
  document.getElementById('dashboard-bitacora').style.display = panel ? 'block' : 'none';
  document.getElementById('dashboard-no-admin').style.display = 'none';
  if(!panel) return;   // además se evita leer 500 registros por cada ingreso de un usuario normal

  const logs = await getLogs();
  const hoy = new Date().toLocaleDateString('es-EC');
  const hoyOk = logs.filter(l=>l.fecha===hoy && l.estado==='ok').length;
  const hoyFail = logs.filter(l=>l.fecha===hoy && l.estado==='fail').length;
  const last = logs.filter(l=>l.estado==='ok')[0];
  document.getElementById('stat-total').textContent = USERS.length;
  document.getElementById('stat-hoy').textContent = hoyOk;
  document.getElementById('stat-fail').textContent = hoyFail;
  if(last){ document.getElementById('stat-last').textContent = (last.nombre||'').split(' ')[0]; document.getElementById('stat-last-time').textContent = last.fecha+' '+last.hora; }

  const recent = [...logs].slice(0,15);
  document.getElementById('log-count-label').textContent = logs.length+' REGISTROS';
  document.getElementById('log-tbody').innerHTML = recent.map(l=>`<tr><td>${esc(l.usuario)}</td><td>${esc(l.nombre)}</td><td>${l.fecha} ${l.hora}</td><td>${l.device}</td><td><span class="badge ${l.estado==='ok'?'badge-ok':'badge-fail'}">${l.estado==='ok'?'✓ EXITOSO':'✗ FALLIDO'}</span></td></tr>`).join('');
}

async function renderAdmin(){
  if(!puedeVerPanel()) return;
  const w = esAdmin();
  // Primero solicitudes y usuarios (lo que el admin necesita ver), sin depender de la bitácora
  try { await renderSolicitudes(); } catch (e) { console.error('renderSolicitudes', e); }
  try { await renderBasePersonalInfo(); } catch (e) { console.error('renderBasePersonalInfo', e); }

  document.getElementById('admin-users-list').innerHTML = USERS.map(u => {
    const isSelf = u.user === currentUser.user;
    const isAdm  = u.rol === 'admin';
    const datosExtra = u.area ? `<br><span style="font-size:.7rem">📍 ${u.area}${u.grado ? ' | ' + u.grado : ''} | CÓD: ${u.codigo}</span>` : '';

    const btnBlock = (w && !isSelf && !isAdm)
      ? (u.blocked
          ? `<button class="btn-unblock" onclick="toggleBlockUser('${u.user}',false)" title="Desbloquear">✓ DESBLOQUEAR</button>`
          : `<button class="btn-block"   onclick="toggleBlockUser('${u.user}',true)"  title="Bloquear">⊘ BLOQUEAR</button>`)
      : '';

    const btnAdmin = (w && !isSelf)
      ? (isAdm
          ? `<button class="btn-block"   onclick="cambiarRol('${u.user}','user')" title="Quitar admin">👤 QUITAR ADMIN</button>`
          : (u.rol === 'supervisor'
              ? `<button class="btn-block" onclick="cambiarRol('${u.user}','user')" title="Quitar supervisor">👤 QUITAR SUPERVISOR</button>`
              : `<button class="btn-unblock" onclick="cambiarRol('${u.user}','supervisor')" title="Hacer supervisor">👁 HACER SUPERVISOR</button>`)
            + `<button class="btn-unblock" onclick="cambiarRol('${u.user}','admin')" title="Hacer admin">🛡 HACER ADMIN</button>`)
      : '';

    const btnDel = (w && !isSelf && !isAdm)
      ? `<button class="btn-block" style="background:var(--danger,#c0392b);color:#fff" onclick="deleteUser('${u.user}')" title="Eliminar">🗑 ELIMINAR</button>`
      : '';

    return `
      <div class="user-row">
        <div class="avatar">${(u.nombre || u.user || '?').split(' ').map(x=>x[0]).slice(0,2).join('')}</div>
        <div class="user-info">
          <strong>${esc(u.nombre)}${u.blocked ? '<span class="blocked-badge">● BLOQUEADO</span>' : ''}</strong>
          <span>${esc(u.user)} · <span class="badge ${isAdm?'badge-admin':(u.rol==='supervisor'?'badge-supervisor':'badge-user')}">${u.rol}</span> · 📧 ${u.email || 'SIN CORREO'}${datosExtra}</span>
          ${u.rol === 'user' ? `<div style="margin-top:.45rem;font-size:.72rem;letter-spacing:.04em">BOTONES ADICIONALES: ${Object.entries(TABS_OPCIONALES).map(([id, n]) => `<label style="margin-right:.9rem;cursor:${w?'pointer':'default'}"><input type="checkbox" ${(u.tabs||[]).includes(id)?'checked':''} ${w?'':'disabled'} onchange="toggleTabUsuario('${u.user}','${id}',this.checked)"/> ${n}</label>`).join('')}</div>` : ''}
        </div>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center">
          ${btnBlock}${btnAdmin}${btnDel}
        </div>
      </div>`;
  }).join('');

  let logs = [];
  try { logs = await getLogs(); } catch (e) { console.error('getLogs', e); }
  
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
  document.getElementById('admin-log-tbody').innerHTML = slice.map(l=>`<tr><td>${esc(l.usuario)}</td><td>${esc(l.nombre)}</td><td>${l.fecha} ${l.hora}</td><td>${l.device}</td><td><span class="badge ${l.estado==='ok'?'badge-ok':(l.estado==='aprobacion'?'badge-admin':'badge-fail')}">${l.estado==='ok'?'✓ EXITOSO':(l.estado==='aprobacion'?'✅ APROBACIÓN':'✗ FALLIDO')}</span>${l.details?`<br><small>${esc(l.details)}</small>`:''}</td></tr>`).join('');
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
    return `<div class="file-card"><div class="file-card-top"><div class="file-type-icon ${TIPO_CSS[f.tipo]}">${TIPO_ICONS[f.tipo]}</div><div><div class="file-card-name">${esc(f.nombre)}</div><div class="file-card-meta">${f.desc?esc(f.desc)+'<br>':''}${f.fecha}</div></div></div><div class="file-card-actions"><a class="file-card-btn file-card-btn-open" href="${viewUrl}" target="_blank">👁️ VER</a><a class="file-card-btn file-card-btn-open" href="${dlUrl}" target="_blank">⬇️ BAJAR</a>${currentUser?.rol==='admin' ? `<button class="file-card-btn file-card-btn-del" onclick="deleteFile(${f.id})">🗑</button>` : ''}</div></div>`;
  }).join('')}</div>`;
}
function renderAllSectionFiles(){ Object.keys(SECCIONES).forEach(s=>renderSectionFiles(s)); }
function renderAdminFiles(){
  const files = getFiles();
  if(!files.length){ document.getElementById('admin-files-list').innerHTML = '<div class="file-empty">SIN ARCHIVOS.</div>'; return; }
  const bySection = {};
  files.forEach(f=>{ if(!bySection[f.seccion]) bySection[f.seccion]=[]; bySection[f.seccion].push(f); });
  document.getElementById('admin-files-list').innerHTML = Object.keys(bySection).map(s=>`<div style="margin-bottom:1rem"><div class="section-badge" style="margin-bottom:.5rem">${SECCIONES[s]||s}</div><div class="files-grid">${bySection[s].map(f=>`<div class="file-card"><div class="file-card-top"><div class="file-type-icon ${TIPO_CSS[f.tipo]}">${TIPO_ICONS[f.tipo]}</div><div><div class="file-card-name">${esc(f.nombre)}</div><div class="file-card-meta">${f.fecha}</div></div></div>${esAdmin() ? `<div class="file-card-actions"><button class="file-card-btn file-card-btn-del" onclick="deleteFile(${f.id})">🗑 ELIMINAR</button></div>` : ''}</div>`).join('')}</div></div>`).join('');
}
function deleteFile(id){
  if (!soloAdmin()) return;
  const file = getFiles().find(f=>f.id===id);
  openModal('ELIMINAR ARCHIVO', `¿ELIMINAR "${file?.nombre}"?`, ()=>{
    const newFiles = getFiles().filter(f=>f.id!==id);
    saveFiles(newFiles);
    auditar('ARCHIVO', `ELIMINÓ EL ARCHIVO "${file?.nombre}" (${SECCIONES[file?.seccion] || file?.seccion || ''})`);
    if (currentUser && currentUser.rol === 'admin') {
      renderAdmin();
      renderAllSectionFiles();
    }
  });
}
async function addFile(){
  if (!soloAdmin()) return;
  const nombre = document.getElementById('af-nombre').value.trim().toUpperCase();
  const seccion = document.getElementById('af-seccion').value;
  const url = document.getElementById('af-url').value.trim();
  const tipo = document.getElementById('af-tipo').value;
  const desc = document.getElementById('af-desc').value.trim().toUpperCase();
  if(!nombre || !url){ showToast('COMPLETA NOMBRE Y ENLACE.', 'error'); return; }
  const newId = Date.now();
  const fecha = new Date().toLocaleDateString('es-EC');
  const entry = { id:newId, nombre, seccion, urlOriginal: url, tipo, desc, fecha, subidoPor: currentUser ? currentUser.nombre : 'ADMIN' };
  const files = getFiles();
  files.push(entry);
  saveFiles(files);
  auditar('ARCHIVO', `AGREGÓ EL ARCHIVO "${nombre}" (${SECCIONES[seccion] || seccion})`);
  document.getElementById('af-nombre').value = '';
  document.getElementById('af-url').value = '';
  document.getElementById('af-desc').value = '';
  const linea = `  { id:${newId}, nombre:'${nombre.replace(/'/g,"\\'")}', seccion:'${seccion}', tipo:'${tipo}', desc:'${desc.replace(/'/g,"\\'")}', fecha:'${fecha}', urlOriginal:'${url}' },`;
  document.getElementById('af-code-text').textContent = linea;
  document.getElementById('af-code-box').style.display = 'block';

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(linea);
      showToast('✅ ARCHIVO AGREGADO — CÓDIGO COPIADO AUTOMÁTICAMENTE AL PORTAPAPELES', 'success');
    } else {
      const ta = document.createElement('textarea');
      ta.value = linea;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('✅ ARCHIVO AGREGADO — CÓDIGO COPIADO AUTOMÁTICAMENTE', 'success');
    }
  } catch(e) {
    showToast('⚠️ ARCHIVO AGREGADO. COPIA EL CÓDIGO MANUALMENTE.', 'info');
  }

  if (currentUser && currentUser.rol === 'admin') {
    renderAdmin();
    renderSectionFiles(seccion);
  }
}
function copiarCodigo(){
  const txt = document.getElementById('af-code-text').textContent;
  navigator.clipboard.writeText(txt);
  showToast('CÓDIGO COPIADO. PÉGALO EN FILES_BASE DEL APP.JS.', 'success');
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
  auditar('EXPORTACION', 'EXPORTÓ LA BITÁCORA DE INGRESOS (CSV)');
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
  if(_accesosChart) renderChart(getLogs());
}
function updateThemeIcon(isDark){
  const btn = document.getElementById('btn-theme-toggle');
  if(btn) btn.textContent = isDark ? '☀️' : '🌙';
}

async function confirmClearLogs(){
  if (!soloAdmin()) return;
  openModal('🗑 BORRAR BITÁCORA', '¿ELIMINAR TODOS LOS REGISTROS DE INGRESOS? (LA AUDITORÍA NO SE BORRA)', async ()=>{
    auditar('ACCION_ADMIN', 'BORRÓ LA BITÁCORA DE INGRESOS');
    const snapshot = await db.collection('logs').get();
    const batch = db.batch();
    snapshot.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    renderDashboard(); 
    if(puedeVerPanel()) { renderAdmin(); }
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
function showTab(id, silencioso){
  if (!tabPermitida(id)) { if (currentUser) showToast('NO TIENE ACCESO A ESTA SECCIÓN', 'error'); return; }
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('tab-'+id).classList.add('active');
  document.querySelectorAll('nav a').forEach(a=>a.classList.remove('active'));
  const lnk = [...document.querySelectorAll('nav a')].find(a=>a.getAttribute('onclick')===`showTab('${id}')`);
  if(lnk) lnk.classList.add('active');
  if(id === 'admin' && puedeVerPanel()) renderAdmin();
  if(id === 'vacaciones') renderVacaciones();
  if(id === 'auditoria') renderAuditoria();
  if(SECCIONES[id]) renderSectionFiles(id);
  if(!silencioso && id !== _ultimaPestana) auditar('PESTANA', 'ABRIÓ LA SECCIÓN ' + id.toUpperCase());
  _ultimaPestana = id;
}
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ==================== VACACIONES 2027 ====================
// Colección: vacaciones_2027/{codigo}. La cédula NO se guarda en texto plano: solo su huella (SHA-256 con sal).
// - Administrador: carga el Excel y consulta a todo el personal.
// - Usuario: solo consulta su propio código, y debe indicar su cédula.
const VAC_COL = 'vacaciones_2027';
const VAC_META = { col: 'config', doc: 'vacaciones_2027' };
const VAC_SALT = 'cte-vac-2027|';
const VAC_MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
const VAC_MAX_INTENTOS = 5;
const VAC_BLOQUEO_MIN = 10;
const VAC_POR_PAGINA = 50;

let _vacDatos = null;       // caché del listado (solo administrador)
let _vacFiltrados = [];
let _vacPagina = 1;
let _vacTimer = null;
let _vacSeq = 0;

// Cédula a 10 dígitos (Excel suele quitar el cero inicial)
function normalizarCedula(v){
  let s = String(v == null ? '' : v).replace(/[^0-9]/g, '');
  if (s.length >= 7 && s.length < 10) s = s.padStart(10, '0');
  return s;
}
function vacHashCedula(ced){ return hashPass(VAC_SALT + ced); }

// ---- Control de intentos fallidos (por usuario, en este navegador) ----
function _vacKey(){ return 'vac_int_' + (currentUser ? currentUser.user : ''); }
function vacMinutosBloqueo(){
  try {
    const r = JSON.parse(localStorage.getItem(_vacKey()) || 'null');
    if (r && r.hasta && Date.now() < r.hasta) return Math.ceil((r.hasta - Date.now()) / 60000);
  } catch (e) {}
  return 0;
}
function vacRegistrarFallo(){
  let r = { n: 0, hasta: 0 };
  try { r = JSON.parse(localStorage.getItem(_vacKey()) || 'null') || r; } catch (e) {}
  if (r.hasta && Date.now() >= r.hasta) r = { n: 0, hasta: 0 };
  r.n = (r.n || 0) + 1;
  let quedan = VAC_MAX_INTENTOS - r.n;
  if (r.n >= VAC_MAX_INTENTOS) { r.hasta = Date.now() + VAC_BLOQUEO_MIN * 60000; r.n = 0; quedan = 0; }
  try { localStorage.setItem(_vacKey(), JSON.stringify(r)); } catch (e) {}
  return quedan;
}
function vacLimpiarFallos(){ try { localStorage.removeItem(_vacKey()); } catch (e) {} }

function renderVacaciones(){
  if (!currentUser) return;
  const isAdmin = puedeVerPanel();
  document.getElementById('vac-admin').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('vac-user').style.display = isAdmin ? 'none' : 'block';
  if (isAdmin) {
    renderVacMeta();
    if (!_vacDatos) cargarVacacionesAdmin(false);
    else vacAplicarFiltros();
  } else {
    const inp = document.getElementById('vac-codigo');
    const nota = document.getElementById('vac-user-nota');
    const vinc = normalizarCodigo(currentUser.codigo);
    document.getElementById('vac-cedula').value = '';
    document.getElementById('vac-resultado').innerHTML = '';
    if (vinc) {
      inp.value = vinc; inp.readOnly = true;
      nota.textContent = 'SOLO PUEDE CONSULTAR LA INFORMACIÓN DEL CÓDIGO DE SU CUENTA. INGRESE SU NÚMERO DE CÉDULA.';
    } else {
      inp.value = ''; inp.readOnly = false;
      nota.textContent = 'INGRESE SU CÓDIGO Y SU NÚMERO DE CÉDULA. LA PRIMERA CONSULTA EXITOSA VINCULA ESE CÓDIGO A SU CUENTA Y NO PODRÁ CONSULTAR OTRO.';
    }
  }
}

// ---------------- USUARIO ----------------
async function consultarVacaciones(){
  const res = document.getElementById('vac-resultado');
  if (!currentUser || puedeVerPanel()) return;

  const bloq = vacMinutosBloqueo();
  if (bloq) { auditar('CONSULTA_FALLIDA', 'CONSULTA BLOQUEADA POR INTENTOS FALLIDOS'); res.innerHTML = `<div style="color:#c0392b;font-size:.88rem">⛔ DEMASIADOS INTENTOS FALLIDOS. INTENTE NUEVAMENTE EN ${bloq} MINUTO(S).</div>`; return; }

  const vinc = normalizarCodigo(currentUser.codigo);
  const codigo = vinc || normalizarCodigo(document.getElementById('vac-codigo').value);
  const ced = normalizarCedula(document.getElementById('vac-cedula').value);

  if (!codigo || ced.length !== 10) {
    res.innerHTML = '<div style="color:#c0392b;font-size:.88rem">❌ INGRESE SU CÓDIGO Y SU CÉDULA (10 DÍGITOS).</div>';
    return;
  }

  res.innerHTML = '<div style="font-size:.88rem">CONSULTANDO...</div>';
  try {
    const [doc, hash] = await Promise.all([
      db.collection(VAC_COL).doc(codigo).get(),
      vacHashCedula(ced)
    ]);
    if (!doc.exists || doc.data().cedHash !== hash) {
      const quedan = vacRegistrarFallo();
      auditar('CONSULTA_FALLIDA', `DATOS NO COINCIDEN - CÓDIGO ${codigo}`);
      res.innerHTML = '<div style="color:#c0392b;font-size:.88rem">❌ EL CÓDIGO Y LA CÉDULA NO COINCIDEN CON NINGÚN REGISTRO.'
        + (quedan > 0 ? ` LE QUEDAN ${quedan} INTENTO(S).` : ` CONSULTA BLOQUEADA POR ${VAC_BLOQUEO_MIN} MINUTOS.`) + '</div>';
      document.getElementById('vac-cedula').value = '';
      return;
    }
    vacLimpiarFallos();
    auditar('CONSULTA_VACACIONES', `CONSULTÓ SUS VACACIONES - CÓDIGO ${codigo}` + (!vinc ? ' (CÓDIGO VINCULADO A LA CUENTA)' : ''));

    if (!vinc) {
      await db.collection('users').doc(currentUser.user).set({ codigo: codigo }, { merge: true });
      currentUser.codigo = codigo;
      const u = USERS.find(x => x.user === currentUser.user);
      if (u) u.codigo = codigo;
      const inp = document.getElementById('vac-codigo');
      inp.value = codigo; inp.readOnly = true;
    }

    const d = doc.data();
    const fila = (k, v) => `<tr><td style="font-weight:600;color:var(--muted);font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;padding:.6rem 1rem;border-bottom:1px solid #f0f2f6;width:40%">${k}</td><td style="padding:.6rem 1rem;border-bottom:1px solid #f0f2f6;font-size:.95rem">${v}</td></tr>`;
    res.innerHTML = `<table style="width:100%;border-collapse:collapse;border:1px solid #dde0e8;border-radius:6px">`
      + fila('Código', esc(codigo))
      + fila('Cédula', esc(ced))
      + fila('Grado', esc(d.grado || '—'))
      + fila('Nombre y Apellidos', esc(`${d.apellidos || ''} ${d.nombres || ''}`.trim() || '—'))
      + fila('Mes de Vacaciones', `<strong>${esc(d.mes || '—')}</strong>`)
      + `</table>`;
    document.getElementById('vac-cedula').value = '';
  } catch (err) {
    console.error(err);
    res.innerHTML = '<div style="color:#c0392b;font-size:.88rem">⚠ NO SE PUDO REALIZAR LA CONSULTA. INTENTE NUEVAMENTE.</div>';
  }
}

// ---------------- ADMINISTRADOR: carga del Excel ----------------
// Función pura: recibe las filas de la hoja (matriz) y devuelve registros + resumen
function vacParsearFilas(filas){
  const norm = r => (r || []).map(_normHeader);
  const hIdx = filas.findIndex(r => { const n = norm(r); return n.includes('CODIGO') && n.includes('CEDULA'); });
  if (hIdx < 0) return { error: 'NO SE ENCONTRÓ LA FILA DE ENCABEZADOS (CODIGO, CEDULA).' };

  const h = norm(filas[hIdx]);
  const col = nombre => h.indexOf(nombre);
  const colLike = pref => h.findIndex(x => x.startsWith(pref));
  const c = {
    cod: col('CODIGO'), ced: col('CEDULA'), grado: col('GRADO'), ape: col('APELLIDOS'),
    nom: col('NOMBRE') >= 0 ? col('NOMBRE') : col('NOMBRES'),
    area: col('AREA ACTUAL') >= 0 ? col('AREA ACTUAL') : col('AREA'),
    mes: colLike('MES QUE SE PROGRAMO'), gozados: colLike('DIAS GOZADOS'), prov: col('PROVINCIA')
  };
  const cMeses = VAC_MESES.map(m => col(m));
  if (c.mes < 0 && cMeses.every(i => i < 0)) return { error: 'NO SE ENCONTRÓ LA COLUMNA DEL MES DE VACACIONES.' };

  const txt = (r, i) => i >= 0 ? String(r[i] == null ? '' : r[i]).trim().toUpperCase() : '';
  const registros = [];
  const vistos = new Set();
  let duplicados = 0, sinCedula = 0, sinMes = 0;

  for (let i = hIdx + 1; i < filas.length; i++) {
    const r = filas[i];
    const codigo = normalizarCodigo(r[c.cod]);
    if (!codigo) continue;
    if (vistos.has(codigo)) { duplicados++; continue; }
    vistos.add(codigo);

    const cedula = normalizarCedula(r[c.ced]);
    if (cedula.length !== 10) sinCedula++;

    let mes = txt(r, c.mes);
    let dias = 0;
    cMeses.forEach((ci, k) => {
      if (ci >= 0 && r[ci] !== '' && r[ci] != null && Number(r[ci]) > 0) {
        dias = Number(r[ci]);
        if (!VAC_MESES.includes(mes)) mes = VAC_MESES[k];
      }
    });
    if (!VAC_MESES.includes(mes)) { mes = ''; sinMes++; }

    registros.push({
      codigo, cedula,
      grado: txt(r, c.grado), apellidos: txt(r, c.ape), nombres: txt(r, c.nom),
      area: txt(r, c.area), provincia: txt(r, c.prov), mes, dias,
      diasGozados: Number(r[c.gozados]) || 0
    });
  }
  return { registros, duplicados, sinCedula, sinMes };
}

async function renderVacMeta(){
  const el = document.getElementById('vac-meta');
  if (!el) return;
  try {
    const doc = await db.collection(VAC_META.col).doc(VAC_META.doc).get();
    if (!doc.exists) { el.textContent = 'BASE DE VACACIONES AÚN NO CARGADA.'; return; }
    const d = doc.data();
    el.innerHTML = `📄 <strong>${d.total || 0}</strong> REGISTROS · ÚLTIMA ACTUALIZACIÓN: ${esc(d.fecha || '—')} · POR: ${esc(d.actualizadoPor || '—')}`;
  } catch (err) { el.textContent = 'NO SE PUDO LEER LA INFORMACIÓN DE LA BASE.'; }
}

async function subirVacaciones(){
  if (!currentUser || currentUser.rol !== 'admin') { showToast('SOLO EL ADMINISTRADOR PUEDE ACTUALIZAR LAS VACACIONES', 'error'); return; }
  const input = document.getElementById('vac-file');
  const estado = document.getElementById('vac-estado');
  const file = input && input.files ? input.files[0] : null;
  if (!file) { showToast('SELECCIONE EL ARCHIVO EXCEL', 'error'); return; }
  if (typeof XLSX === 'undefined') { showToast('NO SE CARGÓ LA LIBRERÍA DE EXCEL. RECARGUE LA PÁGINA.', 'error'); return; }

  estado.textContent = 'LEYENDO ARCHIVO...';
  let parsed;
  try {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const nombreHoja = wb.SheetNames.find(n => _normHeader(n).includes('VACACIONES')) || wb.SheetNames[0];
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[nombreHoja], { header: 1, defval: '', raw: true });
    parsed = vacParsearFilas(filas);
  } catch (err) {
    console.error(err);
    estado.textContent = '❌ NO SE PUDO LEER EL ARCHIVO: ' + err.message;
    return;
  }
  if (parsed.error) { estado.textContent = '❌ ' + parsed.error; return; }
  const registros = parsed.registros;
  if (!registros.length) { estado.textContent = '❌ NO SE ENCONTRARON REGISTROS VÁLIDOS.'; return; }

  estado.textContent = 'PROCESANDO CÉDULAS...';
  for (const r of registros) r.cedHash = r.cedula.length === 10 ? await vacHashCedula(r.cedula) : '';

  const avisos = [];
  if (parsed.duplicados) avisos.push(`${parsed.duplicados} CÓDIGOS REPETIDOS (SE USÓ EL PRIMERO)`);
  if (parsed.sinCedula) avisos.push(`${parsed.sinCedula} SIN CÉDULA VÁLIDA (NO PODRÁN CONSULTAR)`);
  if (parsed.sinMes) avisos.push(`${parsed.sinMes} SIN MES`);

  openModal(
    'ACTUALIZAR VACACIONES 2027',
    `SE REEMPLAZARÁ TODA LA BASE DE VACACIONES POR ${registros.length} REGISTROS DEL ARCHIVO "${file.name}".` + (avisos.length ? ' AVISOS: ' + avisos.join('; ') + '.' : '') + ' ¿CONTINUAR?',
    async () => {
      try {
        const nuevos = new Set(registros.map(r => r.codigo));
        for (let i = 0; i < registros.length; i += BASE_LOTE) {
          const batch = db.batch();
          registros.slice(i, i + BASE_LOTE).forEach(r => {
            batch.set(db.collection(VAC_COL).doc(r.codigo), {
              grado: r.grado, apellidos: r.apellidos, nombres: r.nombres, area: r.area,
              provincia: r.provincia, mes: r.mes, dias: r.dias, diasGozados: r.diasGozados, cedHash: r.cedHash
            });
          });
          await batch.commit();
          estado.textContent = `SUBIENDO REGISTROS... ${Math.min(i + BASE_LOTE, registros.length)}/${registros.length}`;
        }

        // Eliminar los códigos que ya no están en el archivo (después de subir, para no dejar la base vacía si algo falla)
        estado.textContent = 'DEPURANDO REGISTROS ANTERIORES...';
        const snap = await db.collection(VAC_COL).get();
        const sobrantes = snap.docs.filter(d => !nuevos.has(d.id));
        for (let i = 0; i < sobrantes.length; i += BASE_LOTE) {
          const batch = db.batch();
          sobrantes.slice(i, i + BASE_LOTE).forEach(d => batch.delete(d.ref));
          await batch.commit();
        }

        await db.collection(VAC_META.col).doc(VAC_META.doc).set({
          total: registros.length,
          fecha: new Date().toLocaleString('es-EC'),
          actualizadoPor: currentUser.nombre || currentUser.user,
          archivo: file.name
        });

        estado.textContent = `✅ VACACIONES ACTUALIZADAS: ${registros.length} REGISTROS` + (sobrantes.length ? ` (${sobrantes.length} ANTERIORES ELIMINADOS)` : '') + '.';
        input.value = '';
        addLog(currentUser.user, currentUser.nombre, 'aprobacion', currentUser.email || '',
          `BASE DE VACACIONES 2027 ACTUALIZADA - ${registros.length} REGISTROS (${file.name})`);
        showToast(`✅ VACACIONES ACTUALIZADAS (${registros.length} REGISTROS)`, 'success');
        renderVacMeta();
        cargarVacacionesAdmin(true);
      } catch (err) {
        console.error(err);
        estado.textContent = '❌ ERROR AL ACTUALIZAR: ' + err.message;
        showToast('ERROR AL ACTUALIZAR LAS VACACIONES', 'error');
      }
    }
  );
}

// ---------------- ADMINISTRADOR: consulta general ----------------
async function cargarVacacionesAdmin(forzar){
  if (!puedeVerPanel()) return;
  if (_vacDatos && !forzar) { vacAplicarFiltros(); return; }
  const resumen = document.getElementById('vac-resumen');
  resumen.textContent = 'CARGANDO LISTADO...';
  try {
    const snap = await db.collection(VAC_COL).get();
    _vacDatos = snap.docs.map(d => ({ codigo: d.id, ...d.data() }));
    auditar('CONSULTA_VACACIONES', `ABRIÓ EL LISTADO GENERAL DE VACACIONES (${_vacDatos.length} REGISTROS)`);
    _vacDatos.sort((a, b) => (a.apellidos + a.nombres).localeCompare(b.apellidos + b.nombres, 'es'));

    const sel = (id, titulo, valores) => {
      const el = document.getElementById(id);
      const actual = el.value;
      el.innerHTML = `<option value="">${titulo}</option>` + valores.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
      el.value = valores.includes(actual) ? actual : '';
    };
    sel('vac-f-mes', 'TODOS LOS MESES', VAC_MESES);
    sel('vac-f-prov', 'TODAS LAS PROVINCIAS', [...new Set(_vacDatos.map(d => d.provincia).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')));
    vacAplicarFiltros();
  } catch (err) {
    console.error(err);
    resumen.textContent = '⚠ NO SE PUDO CARGAR EL LISTADO.';
  }
}

function vacProgramarFiltro(){ clearTimeout(_vacTimer); _vacTimer = setTimeout(vacAplicarFiltros, 250); }

async function vacAplicarFiltros(){
  if (!_vacDatos) return;
  const seq = ++_vacSeq;
  const q = document.getElementById('vac-q').value.trim().toUpperCase();
  const mes = document.getElementById('vac-f-mes').value;
  const prov = document.getElementById('vac-f-prov').value;

  const soloDigitos = q.replace(/[^0-9]/g, '');
  let hashQ = '';
  if (q && /^[0-9\s]+$/.test(q) && soloDigitos.length >= 9 && soloDigitos.length <= 10) {
    hashQ = await vacHashCedula(normalizarCedula(soloDigitos));
    if (seq !== _vacSeq) return;
  }
  const qCod = normalizarCodigo(q);

  _vacFiltrados = _vacDatos.filter(d => {
    if (mes && d.mes !== mes) return false;
    if (prov && d.provincia !== prov) return false;
    if (!q) return true;
    if (hashQ && d.cedHash === hashQ) return true;
    if (qCod && /^[0-9]+$/.test(q) && d.codigo === qCod) return true;
    return `${d.apellidos} ${d.nombres} ${d.area} ${d.grado}`.includes(q);
  });
  _vacPagina = 1;
  renderVacTabla();
  vacAuditarBusqueda(q);
}

let _vacAudTimer = null;
function vacAuditarBusqueda(q) {
  clearTimeout(_vacAudTimer);
  if (!q) return;
  _vacAudTimer = setTimeout(() => {
    let t;
    if (/^[0-9\s]+$/.test(q)) { const d = q.replace(/\D/g, ''); t = d.length >= 9 ? 'POR CÉDULA' : 'POR CÓDIGO ' + d; }
    else t = 'POR TEXTO "' + q.slice(0, 40) + '"';
    auditar('CONSULTA_VACACIONES', 'BÚSQUEDA EN EL LISTADO GENERAL ' + t);
  }, 1500);
}

function renderVacTabla(){
  const total = _vacFiltrados.length;
  const paginas = Math.max(1, Math.ceil(total / VAC_POR_PAGINA));
  if (_vacPagina > paginas) _vacPagina = paginas;
  const slice = _vacFiltrados.slice((_vacPagina - 1) * VAC_POR_PAGINA, _vacPagina * VAC_POR_PAGINA);

  document.getElementById('vac-resumen').innerHTML = `<strong>${total}</strong> DE ${_vacDatos.length} REGISTROS`;
  document.getElementById('vac-tbody').innerHTML = slice.length
    ? slice.map(d => `<tr><td>${esc(d.codigo)}</td><td>${esc(d.grado || '')}</td><td>${esc(`${d.apellidos || ''} ${d.nombres || ''}`.trim())}</td><td>${esc(d.area || '')}</td><td>${esc(d.provincia || '')}</td><td>${esc(d.mes || '')}</td><td>${d.dias || 0}</td><td>${d.diasGozados || 0}</td></tr>`).join('')
    : '<tr><td colspan="8" style="text-align:center;padding:1.2rem">SIN RESULTADOS</td></tr>';

  document.getElementById('vac-paginacion').innerHTML = paginas > 1
    ? `<button class="btn-add-file" ${_vacPagina <= 1 ? 'disabled' : ''} onclick="vacIrPagina(${_vacPagina - 1})">◀</button>
       <span style="font-size:.82rem">PÁGINA ${_vacPagina} DE ${paginas}</span>
       <button class="btn-add-file" ${_vacPagina >= paginas ? 'disabled' : ''} onclick="vacIrPagina(${_vacPagina + 1})">▶</button>`
    : '';
}
function vacIrPagina(n){ _vacPagina = n; renderVacTabla(); }

// modo: 'todo' = todo el archivo; 'filtrado' = lo que está filtrado en pantalla
function exportarVacaciones(modo){
  if (!puedeVerPanel()) return;
  if (typeof XLSX === 'undefined') { showToast('NO SE CARGÓ LA LIBRERÍA DE EXCEL', 'error'); return; }
  const base = modo === 'todo' ? _vacDatos : _vacFiltrados;
  if (!base || !base.length) { showToast('NO HAY REGISTROS PARA EXPORTAR', 'error'); return; }
  const lista = [...base].sort((a, b) => (VAC_MESES.indexOf(a.mes) - VAC_MESES.indexOf(b.mes)) || (Number(a.codigo) - Number(b.codigo)));
  // Mismas columnas del archivo original (la cédula no se exporta: solo se guarda cifrada)
  const filas = lista.map(d => {
    const f = {
      GRADO: d.grado, CODIGO: d.codigo, APELLIDOS: d.apellidos, NOMBRE: d.nombres, 'AREA ACTUAL': d.area,
      'MES QUE SE PROGRAMO VACACIONES EN EL 2027': d.mes, 'DIAS GOZADOS 2027': d.diasGozados || 0
    };
    VAC_MESES.forEach(m => { f[m] = d.mes === m ? (d.dias || 0) : ''; });
    f.PROVINCIA = d.provincia;
    return f;
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'VACACIONES 2027');
  XLSX.writeFile(wb, modo === 'todo' ? 'vacaciones_2027_completo.xlsx' : 'vacaciones_2027_filtrado.xlsx');
  auditar('EXPORTACION', `EXPORTÓ VACACIONES 2027 (${modo === 'todo' ? 'ARCHIVO COMPLETO' : 'SOLO LO FILTRADO'}): ${lista.length} REGISTROS`);
}

// ==================== AUDITORÍA ====================
// Eventos nuevos → colección "auditoria". Los ingresos históricos siguen en "logs" y se muestran junto a los nuevos.
// Visible para administrador y supervisor.
const AUD_COL = 'auditoria';
const AUD_LIMITE = 5000;
const AUD_POR_PAGINA = 25;
const AUD_TIPOS = {
  LOGIN: 'INGRESO',
  LOGIN_FALLIDO: 'INGRESO FALLIDO',
  LOGOUT: 'CIERRE DE SESIÓN',
  CONSULTA_VACACIONES: 'CONSULTA DE VACACIONES',
  CONSULTA_FALLIDA: 'CONSULTA FALLIDA',
  ACCION_ADMIN: 'ACCIÓN ADMINISTRATIVA',
  EXPORTACION: 'EXPORTACIÓN',
  ARCHIVO: 'ARCHIVOS',
  PESTANA: 'SECCIÓN VISITADA'
};
const AUD_BADGE = { LOGIN: 'badge-ok', LOGIN_FALLIDO: 'badge-fail', CONSULTA_FALLIDA: 'badge-fail', ACCION_ADMIN: 'badge-admin', EXPORTACION: 'badge-admin', ARCHIVO: 'badge-admin', LOGOUT: 'badge-user', CONSULTA_VACACIONES: 'badge-supervisor', PESTANA: 'badge-user' };

let _ultimaPestana = null;
let _audEventos = [];
let _audFiltrados = [];
let _audPagina = 1;

// Registra un evento del usuario con sesión iniciada (no bloquea la pantalla si falla)
function auditar(tipo, detalle) {
  if (!currentUser) return;
  const now = new Date();
  const entry = {
    usuario: currentUser.user,
    nombre: currentUser.nombre || '',
    rol: currentUser.rol || '',
    email: currentUser.email || '',
    tipo,
    details: detalle || '',
    fecha: now.toLocaleDateString('es-EC'),
    hora: now.toLocaleTimeString('es-EC'),
    device: /Mobi|Android/i.test(navigator.userAgent) ? 'MÓVIL' : 'COMPUTADORA',
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  };
  try { db.collection(AUD_COL).add(entry).catch(err => console.error('Auditoría:', err)); } catch (err) { console.error('Auditoría:', err); }
}

function _audMs(t) { return t && t.toMillis ? t.toMillis() : (t && t.seconds ? t.seconds * 1000 : Date.now()); }
function _audDia(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function _audDiaTxt(key) { const [y, m, d] = key.split('-'); return `${d}/${m}/${y}`; }

function audTipoDeLog(x) {
  return x.tipo || (x.estado === 'ok' ? 'LOGIN' : (x.estado === 'fail' ? 'LOGIN_FALLIDO' : 'ACCION_ADMIN'));
}

async function renderAuditoria() {
  if (!puedeVerPanel()) return;
  const estado = document.getElementById('aud-estado');
  estado.textContent = 'CARGANDO AUDITORÍA...';
  const dias = Number(document.getElementById('aud-dias').value) || 30;
  const desde = new Date(); desde.setDate(desde.getDate() - dias + 1); desde.setHours(0, 0, 0, 0);
  const ts = firebase.firestore.Timestamp.fromDate(desde);

  const consulta = col => db.collection(col).where('timestamp', '>=', ts).orderBy('timestamp', 'desc').limit(AUD_LIMITE).get();
  const [rAud, rLogs] = await Promise.allSettled([consulta(AUD_COL), consulta('logs')]);

  const ev = [];
  let aviso = '';
  if (rAud.status === 'fulfilled') {
    rAud.value.docs.forEach(d => {
      const x = d.data();
      ev.push({ ms: _audMs(x.timestamp), usuario: x.usuario || '', nombre: x.nombre || '', tipo: x.tipo || 'PESTANA', detalle: x.details || '', device: x.device || '', fecha: x.fecha, hora: x.hora });
    });
  } else {
    console.error(rAud.reason);
    aviso = '⚠ NO SE PUDO LEER LA COLECCIÓN "auditoria". REVISE LAS REGLAS DE FIRESTORE. ';
  }
  if (rLogs.status === 'fulfilled') {
    rLogs.value.docs.forEach(d => {
      const x = d.data();
      ev.push({ ms: _audMs(x.timestamp), usuario: x.usuario || '', nombre: x.nombre || '', tipo: audTipoDeLog(x), detalle: x.details || '', device: x.device || '', fecha: x.fecha, hora: x.hora });
    });
  } else {
    console.error(rLogs.reason);
    aviso += '⚠ NO SE PUDO LEER LA BITÁCORA DE INGRESOS. ';
  }
  ev.sort((a, b) => b.ms - a.ms);
  _audEventos = ev;
  estado.textContent = aviso;

  // opciones del filtro de evento
  const sel = document.getElementById('aud-f-tipo');
  const actual = sel.value;
  sel.innerHTML = '<option value="">TODOS LOS EVENTOS</option>' + Object.entries(AUD_TIPOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  sel.value = actual;

  renderAuditoriaResumen();
  audAplicar();
}

// Tarjetas del resumen y tabla "personas por día"
function renderAuditoriaResumen() {
  const hoy = _audDia(Date.now());
  const ev = _audEventos;
  const loginsHoy = ev.filter(e => e.tipo === 'LOGIN' && _audDia(e.ms) === hoy);
  document.getElementById('aud-personas-hoy').textContent = new Set(loginsHoy.map(e => e.usuario)).size;
  document.getElementById('aud-eventos-hoy').textContent = ev.filter(e => _audDia(e.ms) === hoy).length;
  document.getElementById('aud-fallidos-hoy').textContent = ev.filter(e => e.tipo === 'LOGIN_FALLIDO' && _audDia(e.ms) === hoy).length;
  document.getElementById('aud-pendientes').textContent = (window._solicitudesCache || []).length;

  const porDia = {};
  ev.filter(e => e.tipo === 'LOGIN').forEach(e => {
    const k = _audDia(e.ms);
    (porDia[k] = porDia[k] || { personas: new Set(), ingresos: 0 });
    porDia[k].personas.add(e.usuario);
    porDia[k].ingresos++;
  });
  // todos los días del rango, aunque no haya habido ingresos
  const dias = Number(document.getElementById('aud-dias').value) || 30;
  const filas = [];
  for (let i = 0; i < dias; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = _audDia(d.getTime());
    filas.push({ k, personas: porDia[k] ? porDia[k].personas.size : 0, ingresos: porDia[k] ? porDia[k].ingresos : 0 });
  }
  const max = Math.max(1, ...filas.map(f => f.personas));
  document.getElementById('aud-dia-tbody').innerHTML = filas.map(f =>
    `<tr><td>${_audDiaTxt(f.k)}</td><td style="width:55%"><div style="display:flex;align-items:center;gap:.6rem"><div style="height:10px;border-radius:5px;background:var(--gold);width:${Math.round(f.personas / max * 100)}%;min-width:${f.personas ? 4 : 0}px"></div><strong>${f.personas}</strong></div></td><td>${f.ingresos}</td></tr>`
  ).join('');
}

function audAplicar() {
  const tipo = document.getElementById('aud-f-tipo').value;
  const q = document.getElementById('aud-q').value.trim().toUpperCase();
  const desde = document.getElementById('aud-desde').value;
  const hasta = document.getElementById('aud-hasta').value;
  _audFiltrados = _audEventos.filter(e => {
    if (tipo && e.tipo !== tipo) return false;
    const dk = _audDia(e.ms);
    if (desde && dk < desde) return false;
    if (hasta && dk > hasta) return false;
    if (q && !`${e.usuario} ${e.nombre} ${e.detalle}`.toUpperCase().includes(q)) return false;
    return true;
  });
  _audPagina = 1;
  renderAuditoriaTabla();
}

function renderAuditoriaTabla() {
  const total = _audFiltrados.length;
  const paginas = Math.max(1, Math.ceil(total / AUD_POR_PAGINA));
  if (_audPagina > paginas) _audPagina = paginas;
  const slice = _audFiltrados.slice((_audPagina - 1) * AUD_POR_PAGINA, _audPagina * AUD_POR_PAGINA);
  document.getElementById('aud-resumen').innerHTML = `<strong>${total}</strong> EVENTOS`;
  document.getElementById('aud-tbody').innerHTML = slice.length
    ? slice.map(e => `<tr><td>${esc(e.fecha || _audDiaTxt(_audDia(e.ms)))} ${esc(e.hora || '')}</td><td>${esc(e.usuario)}</td><td>${esc(e.nombre)}</td><td><span class="badge ${AUD_BADGE[e.tipo] || 'badge-user'}">${esc(AUD_TIPOS[e.tipo] || e.tipo)}</span></td><td>${esc(e.detalle)}</td><td>${esc(e.device)}</td></tr>`).join('')
    : '<tr><td colspan="6" style="text-align:center;padding:1.2rem">SIN EVENTOS</td></tr>';
  document.getElementById('aud-paginacion').innerHTML = paginas > 1
    ? `<button class="btn-add-file" ${_audPagina <= 1 ? 'disabled' : ''} onclick="audIrPagina(${_audPagina - 1})">◀</button>
       <span style="font-size:.82rem">PÁGINA ${_audPagina} DE ${paginas}</span>
       <button class="btn-add-file" ${_audPagina >= paginas ? 'disabled' : ''} onclick="audIrPagina(${_audPagina + 1})">▶</button>`
    : '';
}
function audIrPagina(n) { _audPagina = n; renderAuditoriaTabla(); }

function exportarAuditoria() {
  if (!puedeVerPanel()) return;
  if (typeof XLSX === 'undefined') { showToast('NO SE CARGÓ LA LIBRERÍA DE EXCEL', 'error'); return; }
  if (!_audFiltrados.length) { showToast('NO HAY EVENTOS PARA EXPORTAR', 'error'); return; }
  const filas = _audFiltrados.map(e => ({
    FECHA: e.fecha || _audDiaTxt(_audDia(e.ms)), HORA: e.hora || '', USUARIO: e.usuario, NOMBRE: e.nombre,
    EVENTO: AUD_TIPOS[e.tipo] || e.tipo, DETALLE: e.detalle, DISPOSITIVO: e.device
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'AUDITORIA');
  XLSX.writeFile(wb, 'auditoria_cte.xlsx');
  auditar('EXPORTACION', `EXPORTÓ LA AUDITORÍA (${filas.length} EVENTOS)`);
}

// ==================== INICIALIZACIÓN ====================
(async function init(){
  await initializeUsers();
  listenToSolicitudes();
  const savedDark = localStorage.getItem('darkMode') === 'true';
  if(savedDark){ document.body.classList.add('dark-mode'); }
  updateThemeIcon(savedDark);
  renderAllSectionFiles();
})();
