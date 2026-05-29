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
  { user:'admin', passHash:'', nombre:'ADMINISTRADOR SISTEMA', rol:'admin', email:'ctepersonal0@gmail.com', blocked: false, area:'', provincia:'', codigo:'' },
];

const FILES_BASE = [
  { id:1779224557782, nombre:'HISTORIAL CTE', seccion:'organico', tipo:'excel', desc:'', fecha:'19/05/2026', urlOriginal:'https://drive.google.com/drive/folders/1IKszLxBRMZTpv0CyJYaFJ11KbmaftAlW?usp=sharing' },
  { id:1780020641758, nombre:'ORDEN DEL CUERPO 2026', seccion:'orden', tipo:'pdf', desc:'', fecha:'28/5/2026', urlOriginal:'https://drive.google.com/drive/folders/1Np2lvD-Rlgxkkq9_OGPIrlJAHrRyiE3M?usp=drive_link' },
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
let solicitudesUnsubscribe = null;

// Cargar usuarios desde Firestore con escucha en tiempo real
async function initializeUsers() {
  showToast('Conectando a la nube...', 'info', 2000);
  
  db.collection('users').onSnapshot(async (snapshot) => {
    const usersFromFirestore = [];
    snapshot.forEach(doc => {
      usersFromFirestore.push({ id: doc.id, ...doc.data() });
    });
    
    if (usersFromFirestore.length > 0) {
      USERS = usersFromFirestore;
      localStorage.setItem('cte_users_cache', JSON.stringify(USERS));
      
      let needsSave = false;
      for (let u of USERS) {
        if (!u.passHash) {
          const defaultPass = u.user === 'admin' ? '@dmin2026' : 'cte2026';
          u.passHash = await hashPass(defaultPass);
          needsSave = true;
        }
      }
      if (needsSave) await saveUsers();
      
      if (currentUser && currentUser.rol === 'admin') renderAdmin();
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
  saveUsers();
  if (currentUser && currentUser.rol === 'admin') {
    renderAdmin();
  }
}

// ==================== ACCIONES INLINE DE USUARIOS ====================

async function deleteUser(username) {
  const user = USERS.find(u => u.user === username);
  if (!user) return;
  if (user.rol === 'admin') { showToast('NO SE PUEDE ELIMINAR AL ADMINISTRADOR PRINCIPAL', 'error'); return; }
  openModal('ELIMINAR USUARIO', `¿ELIMINAR A ${user.nombre}?`, async () => {
    USERS = USERS.filter(u => u.user !== username);
    await db.collection('users').doc(username).delete();
    localStorage.setItem('cte_users_cache', JSON.stringify(USERS));
    renderAdmin();
    showToast(`USUARIO ${user.nombre} ELIMINADO`, 'success');
  });
}

async function toggleAdminRole(username) {
  const user = USERS.find(u => u.user === username);
  if (!user || user.user === currentUser.user) { showToast('NO PUEDES MODIFICAR TU PROPIO ROL', 'error'); return; }
  const nuevoRol = user.rol === 'admin' ? 'user' : 'admin';
  const label = nuevoRol === 'admin' ? 'ADMINISTRADOR' : 'USUARIO';
  openModal('CAMBIAR ROL', `¿CAMBIAR ROL DE ${user.nombre} A ${label}?`, async () => {
    user.rol = nuevoRol;
    await saveUsers();
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

// ==================== SOLICITAR REGISTRO ====================
async function solicitarRegistro() {
  const area = document.getElementById('reg-area').value.trim().toUpperCase();
  const provincia = document.getElementById('reg-provincia').value.trim().toUpperCase();
  const codigo = document.getElementById('reg-codigo').value.trim().toUpperCase();
  const email = document.getElementById('reg-email').value.trim().toLowerCase();

  if (!area || !provincia || !codigo || !email) {
    mostrarError('COMPLETA TODOS LOS CAMPOS');
    return;
  }

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
    provincia,
    codigo,
    email,
    fecha: new Date().toLocaleDateString('es-EC'),
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    estado: 'pendiente'
  };

  await db.collection('solicitudes').add(nuevaSolicitud);

  mostrarExito('✅ SOLICITUD ENVIADA. ESPERA LA APROBACIÓN DEL ADMINISTRADOR PARA PODER INGRESAR.');
  document.getElementById('reg-area').value = '';
  document.getElementById('reg-provincia').value = '';
  document.getElementById('reg-codigo').value = '';
  document.getElementById('reg-email').value = '';
}

async function aprobarSolicitud(id) {
  const docRef = db.collection('solicitudes').doc(id);
  const doc = await docRef.get();
  
  if (!doc.exists) return;
  
  const solicitud = doc.data();

  const nombreCompleto = `${solicitud.area} - ${solicitud.provincia} (${solicitud.codigo})`;
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
    provincia: solicitud.provincia,
    codigo: solicitud.codigo,
    creado: firebase.firestore.FieldValue.serverTimestamp()
  };

  USERS.push(nuevoUsuario);
  await saveUsers();
  await docRef.update({ estado: 'aprobada', fechaAprobacion: firebase.firestore.FieldValue.serverTimestamp() });

  addLog(username, nombreCompleto, 'aprobacion', solicitud.email,
    `CUENTA APROBADA POR ADMINISTRADOR - ÁREA: ${solicitud.area}, PROVINCIA: ${solicitud.provincia}, CÓDIGO: ${solicitud.codigo}`);

  if (currentUser && currentUser.rol === 'admin') renderAdmin();
  showToast(`✅ USUARIO ${nombreCompleto} APROBADO CORRECTAMENTE.`, 'success');
}

async function rechazarSolicitud(id) {
  const docRef = db.collection('solicitudes').doc(id);
  const doc = await docRef.get();
  const solicitud = doc.data();

  openModal('RECHAZAR SOLICITUD', `¿RECHAZAR LA SOLICITUD DE ${solicitud.area} - ${solicitud.provincia} (${solicitud.codigo})?`, async () => {
    await docRef.update({ estado: 'rechazada', fechaRechazo: firebase.firestore.FieldValue.serverTimestamp() });
    if (currentUser && currentUser.rol === 'admin') renderAdmin();
    showToast('❌ Solicitud rechazada', 'error');
  });
}

async function renderSolicitudes() {
  const container = document.getElementById('solicitudes-list');
  if (!container) return;

  container.innerHTML = '<div class="file-empty">⏳ CARGANDO SOLICITUDES...</div>';

  const snapshot = await db.collection('solicitudes')
    .where('estado', '==', 'pendiente')
    .get();

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
              <div class="file-card-name">${esc(s.area)}</div>
              <div class="file-card-meta">PROVINCIA: ${esc(s.provincia)}<br>CÓDIGO: ${esc(s.codigo)}<br>CORREO: ${esc(s.email)}<br>SOLICITADO: ${s.fecha}</div>
            </div>
          </div>
          <div class="file-card-actions">
            <button class="file-card-btn file-card-btn-open btn-approve" onclick="aprobarSolicitud('${s.id}')">✓ APROBAR</button>
            <button class="file-card-btn file-card-btn-del btn-reject" onclick="rechazarSolicitud('${s.id}')">✗ RECHAZAR</button>
          </div>
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
  let csv = "NOMBRE,USUARIO,ROL,EMAIL,ÁREA,PROVINCIA,CÓDIGO INSTITUCIONAL,ESTADO\n";
  USERS.forEach(u => {
    csv += `"${u.nombre}","${u.user}","${u.rol === 'admin' ? 'ADMINISTRADOR' : 'USUARIO'}","${u.email || ''}","${u.area || ''}","${u.provincia || ''}","${u.codigo || ''}","${u.blocked ? 'BLOQUEADO' : 'ACTIVO'}"\n`;
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
  
  renderDashboard();
  renderAllSectionFiles();
  if (isAdmin) {
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

function doLogout(){
  currentUser = null;
  document.getElementById('screen-main').style.display = 'none';
  document.getElementById('screen-login').style.display = 'flex';
  document.getElementById('nav-admin').style.display = 'none';
  document.getElementById('print-btn').style.display = 'none';
}

// ==================== RENDERIZADO PRINCIPAL ====================
async function renderDashboard(){
  const logs = await getLogs();
  const hoy = new Date().toLocaleDateString('es-EC');
  const hoyOk = logs.filter(l=>l.fecha===hoy && l.estado==='ok').length;
  const hoyFail = logs.filter(l=>l.fecha===hoy && l.estado==='fail').length;
  const last = logs.filter(l=>l.estado==='ok')[0];
  document.getElementById('stat-total').textContent = USERS.length;
  document.getElementById('stat-hoy').textContent = hoyOk;
  document.getElementById('stat-fail').textContent = hoyFail;
  if(last){ document.getElementById('stat-last').textContent = last.nombre.split(' ')[0]; document.getElementById('stat-last-time').textContent = last.fecha+' '+last.hora; }
  
  const isAdmin = currentUser && currentUser.rol === 'admin';
  // ── Solo admin ve las tarjetas de estadísticas ──
  document.getElementById('dashboard-stats').style.display = isAdmin ? '' : 'none';
  document.getElementById('dashboard-bitacora').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('dashboard-no-admin').style.display = isAdmin ? 'none' : 'block';
  if(isAdmin){
    const recent = [...logs].slice(0,15);
    document.getElementById('log-count-label').textContent = logs.length+' REGISTROS';
    document.getElementById('log-tbody').innerHTML = recent.map(l=>`<tr><td>${esc(l.usuario)}</td><td>${esc(l.nombre)}</td><td>${l.fecha} ${l.hora}</td><td>${l.device}</td><td><span class="badge ${l.estado==='ok'?'badge-ok':'badge-fail'}">${l.estado==='ok'?'✓ EXITOSO':'✗ FALLIDO'}</span></td></tr>`).join('');
  }
}

async function renderAdmin(){
  if(!currentUser||currentUser.rol!=='admin') return;
  const logs = await getLogs();
  
  await renderSolicitudes();
  
  document.getElementById('admin-users-list').innerHTML = USERS.map(u => {
    const isSelf = u.user === currentUser.user;
    const isAdm  = u.rol === 'admin';
    const datosExtra = u.area ? `<br><span style="font-size:.7rem">📍 ${u.area} | ${u.provincia} | CÓD: ${u.codigo}</span>` : '';

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
        <div class="avatar">${u.nombre.split(' ').map(x=>x[0]).slice(0,2).join('')}</div>
        <div class="user-info">
          <strong>${esc(u.nombre)}${u.blocked ? '<span class="blocked-badge">● BLOQUEADO</span>' : ''}</strong>
          <span>${esc(u.user)} · <span class="badge ${isAdm?'badge-admin':'badge-user'}">${u.rol}</span> · 📧 ${u.email || 'SIN CORREO'}${datosExtra}</span>
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
  document.getElementById('admin-files-list').innerHTML = Object.keys(bySection).map(s=>`<div style="margin-bottom:1rem"><div class="section-badge" style="margin-bottom:.5rem">${SECCIONES[s]||s}</div><div class="files-grid">${bySection[s].map(f=>`<div class="file-card"><div class="file-card-top"><div class="file-type-icon ${TIPO_CSS[f.tipo]}">${TIPO_ICONS[f.tipo]}</div><div><div class="file-card-name">${esc(f.nombre)}</div><div class="file-card-meta">${f.fecha}</div></div></div><div class="file-card-actions"><button class="file-card-btn file-card-btn-del" onclick="deleteFile(${f.id})">🗑 ELIMINAR</button></div></div>`).join('')}</div></div>`).join('');
}
function deleteFile(id){
  const file = getFiles().find(f=>f.id===id);
  openModal('ELIMINAR ARCHIVO', `¿ELIMINAR "${file?.nombre}"?`, ()=>{
    const newFiles = getFiles().filter(f=>f.id!==id);
    saveFiles(newFiles);
    if (currentUser && currentUser.rol === 'admin') {
      renderAdmin();
      renderAllSectionFiles();
    }
  });
}
async function addFile(){
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
  showToast('CÓDIGO COPIADO. PÉGALO EN FILES_BASE EN EL HTML.', 'success');
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
  localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
  if(_accesosChart) renderChart(getLogs());
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
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ==================== INICIALIZACIÓN ====================
(async function init(){
  await initializeUsers();
  listenToSolicitudes();
  if(localStorage.getItem('darkMode') === 'true') document.body.classList.add('dark-mode');
  renderAllSectionFiles();
})();
