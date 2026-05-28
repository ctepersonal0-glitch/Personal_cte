# 🚦 Firebase Auth con Validación de Código Institucional

Sistema de registro seguro para agentes de tránsito que valida un **Código Institucional** antes de crear la cuenta en Firebase Auth.

---

## 📐 Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                     FLUJO DE REGISTRO                       │
│                                                             │
│  [App Móvil]                                                │
│       │                                                     │
│       ├─1─▶  Ingresa: email + password + código            │
│       │                                                     │
│       ├─2─▶  Llama Cloud Function: validateAndRegister()   │
│       │              │                                      │
│       │              ├─▶ Verifica rate limiting            │
│       │              ├─▶ Consulta Firestore: /codes/{id}   │
│       │              ├─▶ Si válido: crea usuario en Auth   │
│       │              └─▶ Marca código como USADO           │
│       │                                                     │
│       └─3─▶  Recibe customToken ó error tipificado         │
└─────────────────────────────────────────────────────────────┘
```

> ⚠️ **Regla de oro:** La validación NUNCA ocurre en el cliente. La Cloud Function es el único guardián autorizado para crear usuarios.

---

## 🗂️ Estructura del Proyecto

```
proyecto/
├── functions/
│   ├── src/
│   │   └── auth/
│   │       └── validateAndRegister.js   ← Cloud Function principal
│   ├── index.js
│   └── package.json
├── scripts/
│   └── importCodes.js                   ← Importar CSV/XLSX a Firestore
├── firestore.rules                      ← Reglas de seguridad
├── firestore.indexes.json
└── flutter_app/
    └── lib/
        ├── services/
        │   └── auth_service.dart        ← Servicio de autenticación
        └── screens/
            └── register_screen.dart     ← Pantalla de registro
```

---

## 🚀 Instalación y Setup

### 1. Prerrequisitos

```bash
npm install -g firebase-tools
firebase login
firebase init
```

### 2. Instalar dependencias de Functions

```bash
cd functions
npm install firebase-admin firebase-functions xlsx
```

### 3. Importar códigos institucionales

```bash
# Coloca el archivo Codigo_Institucionales.xlsx en /scripts/
node scripts/importCodes.js
```

### 4. Deploy

```bash
firebase deploy --only functions,firestore:rules
```

---

## 📦 Scripts

### `scripts/importCodes.js`

Importa el archivo Excel a la colección `institutional_codes` de Firestore. **Ejecutar solo una vez.**

```javascript
const admin = require('firebase-admin');
const XLSX = require('xlsx');

admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();

async function importCodes() {
  const workbook = XLSX.readFile('scripts/Codigo_Institucionales.xlsx');
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const batch = db.batch();
  let count = 0;

  for (const [code] of rows) {
    if (!code || isNaN(code)) continue;

    const ref = db.collection('institutional_codes').doc(String(code));
    batch.set(ref, {
      code: Number(code),
      isUsed: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      usedBy: null,
      usedAt: null,
    });

    count++;
    if (count % 499 === 0) {
      await batch.commit();
      console.log(`Importados ${count} códigos...`);
    }
  }

  await batch.commit();
  console.log(`✅ Total importado: ${count} códigos`);
}

importCodes().catch(console.error);
```

---

## ⚙️ Cloud Function

### `functions/src/auth/validateAndRegister.js`

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');

const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutos

exports.validateAndRegister = functions
  .region('us-central1')
  .https.onCall(async (data, context) => {

    const { email, password, institutionalCode } = data;

    // ── 1. Validación básica de inputs ──────────────────────────
    if (!email || !password || !institutionalCode) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Email, contraseña y código institucional son requeridos.'
      );
    }

    if (typeof institutionalCode !== 'string' || !/^\d+$/.test(institutionalCode)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'El código institucional debe ser numérico.'
      );
    }

    // ── 2. Rate Limiting por IP ──────────────────────────────────
    const ip = context.rawRequest?.ip || 'unknown';
    const rateLimitRef = admin.firestore()
      .collection('_rate_limits')
      .doc(`register_${ip.replace(/\./g, '_')}`);

    await admin.firestore().runTransaction(async (tx) => {
      const rateLimitDoc = await tx.get(rateLimitRef);
      const now = Date.now();

      if (rateLimitDoc.exists) {
        const { attempts, windowStart } = rateLimitDoc.data();
        const windowExpired = (now - windowStart) > RATE_LIMIT_WINDOW_MS;

        if (!windowExpired && attempts >= RATE_LIMIT_MAX_ATTEMPTS) {
          throw new functions.https.HttpsError(
            'resource-exhausted',
            'Demasiados intentos. Espere 15 minutos antes de reintentar.'
          );
        }

        tx.set(rateLimitRef, {
          attempts: windowExpired ? 1 : attempts + 1,
          windowStart: windowExpired ? now : windowStart,
          lastAttempt: now,
          ip,
        });
      } else {
        tx.set(rateLimitRef, { attempts: 1, windowStart: now, lastAttempt: now, ip });
      }
    });

    // ── 3. Validación del Código Institucional ───────────────────
    const db = admin.firestore();
    const codeRef = db.collection('institutional_codes').doc(institutionalCode);
    const codeDoc = await codeRef.get();

    if (!codeDoc.exists) {
      // Mismo mensaje genérico: no revelar si el código existe o no
      throw new functions.https.HttpsError(
        'permission-denied',
        'El código institucional no es válido.'
      );
    }

    const codeData = codeDoc.data();

    if (codeData.isUsed) {
      throw new functions.https.HttpsError(
        'already-exists',
        'Este código institucional ya fue utilizado.'
      );
    }

    // ── 4. Crear usuario en Firebase Auth ────────────────────────
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email: email.toLowerCase().trim(),
        password,
        emailVerified: false,
      });
    } catch (authError) {
      if (authError.code === 'auth/email-already-exists') {
        throw new functions.https.HttpsError(
          'already-exists',
          'Este correo electrónico ya está registrado.'
        );
      }
      throw new functions.https.HttpsError('internal', 'Error al crear el usuario.');
    }

    // ── 5. Marcar código como USADO (transacción atómica) ────────
    await db.runTransaction(async (tx) => {
      const freshCode = await tx.get(codeRef);

      // Double-check dentro de la transacción (previene condición de carrera)
      if (freshCode.data().isUsed) {
        await admin.auth().deleteUser(userRecord.uid);
        throw new functions.https.HttpsError(
          'already-exists',
          'Este código institucional ya fue utilizado.'
        );
      }

      tx.update(codeRef, {
        isUsed: true,
        usedBy: userRecord.uid,
        usedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Crear perfil del agente en Firestore
      tx.set(db.collection('agents').doc(userRecord.uid), {
        uid: userRecord.uid,
        email: email.toLowerCase().trim(),
        institutionalCode: Number(institutionalCode),
        role: 'traffic_agent',
        status: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    // ── 6. Generar token personalizado para login inmediato ──────
    const customToken = await admin.auth().createCustomToken(userRecord.uid, {
      role: 'traffic_agent',
      institutionalCode: Number(institutionalCode),
    });

    return {
      success: true,
      uid: userRecord.uid,
      customToken,
    };
  });
```

### `functions/index.js`

```javascript
const admin = require('firebase-admin');
admin.initializeApp();

const { validateAndRegister } = require('./src/auth/validateAndRegister');

module.exports = { validateAndRegister };
```

---

## 🔒 Reglas de Seguridad de Firestore

### `firestore.rules`

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ── Códigos Institucionales ──────────────────────────────────
    // NADIE puede leer/escribir desde el cliente.
    // Solo el Admin SDK (Cloud Functions) tiene acceso.
    match /institutional_codes/{codeId} {
      allow read, write: if false;
    }

    // ── Rate Limits (solo Cloud Functions) ──────────────────────
    match /_rate_limits/{docId} {
      allow read, write: if false;
    }

    // ── Perfil del Agente ────────────────────────────────────────
    // El agente puede leer SOLO su propio perfil.
    match /agents/{uid} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow write: if false; // Solo Cloud Functions escribe
    }
  }
}
```

---

## 📱 Flutter — Cliente

### `lib/services/auth_service.dart`

```dart
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_functions/cloud_functions.dart';

class AuthService {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseFunctions _functions = FirebaseFunctions.instance;

  Future<UserCredential> registerAgent({
    required String email,
    required String password,
    required String institutionalCode,
  }) async {
    try {
      final callable = _functions.httpsCallable(
        'validateAndRegister',
        options: HttpsCallableOptions(timeout: const Duration(seconds: 30)),
      );

      final result = await callable.call({
        'email': email.trim(),
        'password': password,
        'institutionalCode': institutionalCode.trim(),
      });

      final customToken = result.data['customToken'] as String;
      return await _auth.signInWithCustomToken(customToken);

    } on FirebaseFunctionsException catch (e) {
      throw _mapFunctionError(e);
    }
  }

  String _mapFunctionError(FirebaseFunctionsException e) {
    switch (e.code) {
      case 'invalid-argument':
        return 'Datos inválidos: ${e.message}';
      case 'permission-denied':
        return 'Código institucional inválido.';
      case 'already-exists':
        return e.message ?? 'El recurso ya existe.';
      case 'resource-exhausted':
        return 'Demasiados intentos. Espere 15 minutos.';
      default:
        return 'Error de registro. Intente nuevamente.';
    }
  }
}
```

### `lib/screens/register_screen.dart`

```dart
import 'package:flutter/material.dart';
import '../services/auth_service.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  final _codeCtrl = TextEditingController();
  bool _isLoading = false;

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    _codeCtrl.dispose();
    super.dispose();
  }

  Future<void> _handleRegister() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);
    try {
      await AuthService().registerAgent(
        email: _emailCtrl.text,
        password: _passwordCtrl.text,
        institutionalCode: _codeCtrl.text,
      );
      if (mounted) Navigator.pushReplacementNamed(context, '/home');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e.toString()),
            backgroundColor: Colors.red.shade700,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Registro de Agente')),
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              TextFormField(
                controller: _emailCtrl,
                decoration: const InputDecoration(
                  labelText: 'Correo institucional',
                  prefixIcon: Icon(Icons.email_outlined),
                ),
                keyboardType: TextInputType.emailAddress,
                validator: (v) =>
                    (v != null && v.contains('@')) ? null : 'Email inválido',
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _passwordCtrl,
                decoration: const InputDecoration(
                  labelText: 'Contraseña',
                  prefixIcon: Icon(Icons.lock_outline),
                ),
                obscureText: true,
                validator: (v) =>
                    (v != null && v.length >= 8) ? null : 'Mínimo 8 caracteres',
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _codeCtrl,
                decoration: const InputDecoration(
                  labelText: 'Código Institucional',
                  hintText: 'Ej: 4456',
                  prefixIcon: Icon(Icons.badge_outlined),
                ),
                keyboardType: TextInputType.number,
                validator: (v) =>
                    RegExp(r'^\d+$').hasMatch(v ?? '') ? null : 'Solo números',
              ),
              const SizedBox(height: 32),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _isLoading ? null : _handleRegister,
                  child: _isLoading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Registrarse'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
```

---

## 🛡️ Capas de Seguridad Anti-Fuerza Bruta

| Capa | Mecanismo | Dónde |
|------|-----------|-------|
| **1. Rate Limiting** | 5 intentos / 15 min por IP | Cloud Function + Firestore |
| **2. Firebase App Check** | Solo APKs firmadas pueden llamar Functions | Firebase Console |
| **3. Códigos de un solo uso** | `isUsed: true` tras el primer registro | Firestore transaction |
| **4. Mensajes genéricos** | No revelar si el código existe o no | Cloud Function |
| **5. Security Rules** | `allow read, write: if false` en la colección | Firestore Rules |
| **6. Auditoría** | `usedBy`, `usedAt` en cada código | Firestore |

---

## 🗃️ Esquema de Firestore

### Colección: `institutional_codes`

```
institutional_codes/
└── {codeId}  ← el número como string (ej: "4456")
    ├── code: number          // 4456
    ├── isUsed: boolean       // false → true al registrarse
    ├── createdAt: timestamp
    ├── usedBy: string|null   // UID del agente que lo usó
    └── usedAt: timestamp|null
```

### Colección: `agents`

```
agents/
└── {uid}  ← UID de Firebase Auth
    ├── uid: string
    ├── email: string
    ├── institutionalCode: number
    ├── role: "traffic_agent"
    ├── status: "active"
    └── createdAt: timestamp
```

---

## ✅ Checklist de Implementación

- [ ] Ejecutar `importCodes.js` para cargar los códigos a Firestore
- [ ] Deployar la Cloud Function `validateAndRegister`
- [ ] Aplicar `firestore.rules`
- [ ] Habilitar **Firebase App Check** con Play Integrity (Android) / DeviceCheck (iOS)
- [ ] Habilitar verificación de email en Firebase Auth Console
- [ ] Configurar alertas de anomalías en Firebase Console

---

## 🔧 Variables de Entorno (opcional para producción)

```bash
# functions/.env
RATE_LIMIT_MAX_ATTEMPTS=5
RATE_LIMIT_WINDOW_MS=900000
```

```javascript
// En la Cloud Function
const MAX = parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS || '5');
const WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000');
```

---

## 📄 Licencia

Uso interno — Sistema de Agentes de Tránsito.
